import os from 'node:os';
import path from 'node:path';
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  emptyStats,
  JobRegistry,
  newId,
  Session,
  type AgentMessage,
  type UsageStats,
  type UserMessage,
} from '@nova-agent/core';
import {
  builtinPlugins,
  loadSkills,
  PluginHost,
  skillsPlugin,
  type ApprovalMode,
  type SkillMetadata,
} from '@nova-agent/plugins';
import { collectProjectDocs } from './agents-md.js';
import { NOVA_DIR, novaHome, sessionDateBucket, sessionsRoot, type Config } from './config.js';
import { buildContextFragment, declaredShell, type SessionEnvInfo } from './context.js';
import { recordSessionWorkspace } from './sessions.js';
import { buildSystemPrompt } from './system-prompt.js';

/**
 * Shared session startup for all three runners (exec / repl / tui). The
 * runners differ only in their permission model, auto-compact strategy, and
 * rendering shell — the plumbing (session open, client, host+skills, env
 * fragment, system prompt) is identical, so it lives here.
 *
 * Each runner keeps its own hooks/permission/auto-compact wiring: exec uses
 * `wrapAutoCompact` + `never` approval; repl/tui use `shouldCompactBefore`
 * + interactive approval. Those are applied AFTER `createSessionRuntime`
 * returns, so the extraction does not constrain the per-runner strategy.
 */
export interface SessionRuntime {
  session: Session;
  messages: AgentMessage[];
  client: OpenAICompatClient;
  host: PluginHost;
  skills: SkillMetadata[];
  sessionEnv: SessionEnvInfo;
  projectDocs: string[];
  jobs: JobRegistry;
  stats: UsageStats;
  approvalMode: ApprovalMode;
  bashConfig: NonNullable<Config['tools']>['bash'] | undefined;
  codeConfig: NonNullable<Config['tools']>['code'] | undefined;
  spillReadRoot: string;
  /** Re-seed the context fragment for a fresh session (/new). */
  buildFragment: () => string;
  seedContextFragment: () => Promise<void>;
  /** Reload project docs + skills for a workspace switch. Returns updated skills. */
  reloadWorkspaceContext: (dir: string) => Promise<SkillMetadata[]>;
  /** Stable-byte system prompt string. */
  systemPrompt: string;
}

export interface SessionRuntimeOptions {
  rootDir: string;
  config: Config;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
}

export async function createSessionRuntime(opts: SessionRuntimeOptions): Promise<SessionRuntime> {
  const { rootDir, config } = opts;

  // Session: codex-style date-archived JSONL, workspace zero-write.
  const sessionsDir = path.join(sessionsRoot(), sessionDateBucket());
  let messages: AgentMessage[] = [];
  let session: Session;
  if (opts.resumeFile) {
    session = await Session.open(opts.resumeFile);
    messages = session.deriveMessages();
  } else {
    session = await Session.create(sessionsDir);
    await recordSessionWorkspace(session, rootDir);
  }

  const client = new OpenAICompatClient({
    baseURL: config.provider.baseURL,
    apiKey: config.provider.apiKey,
    model: config.provider.model,
    sessionId: session.id,
    ...(config.provider.temperature !== undefined ? { temperature: config.provider.temperature } : {}),
    ...(config.provider.maxTokens !== undefined ? { maxTokens: config.provider.maxTokens } : {}),
  });

  const stats = emptyStats();
  const jobs = new JobRegistry();

  const approvalMode = opts.approvalOverride ?? config.approval ?? 'read-only';

  const bashConfig = config.tools?.bash;
  const codeConfig = config.tools?.code;
  const spillReadRoot = path.join(novaHome(), 'cache', 'tool-outputs');
  const host = new PluginHost(rootDir);
  for (const plugin of builtinPlugins({
    spillReadRoot,
    bash:
      bashConfig?.enabled === false
        ? false
        : {
            ...(bashConfig?.timeoutMs !== undefined ? { timeoutMs: bashConfig.timeoutMs } : {}),
            ...(bashConfig?.shellPath !== undefined ? { shellPath: bashConfig.shellPath } : {}),
          },
    ...(codeConfig !== undefined ? { code: codeConfig } : {}),
  })) {
    host.use(plugin);
  }

  const skills = await loadSkills([
    { dir: path.join(rootDir, NOVA_DIR, 'skills'), level: 'project' },
    { dir: path.join(os.homedir(), '.nova', 'skills'), level: 'user' },
  ]);
  if (skills.length > 0) host.use(skillsPlugin(skills));
  await host.activate();

  const sessionEnv: SessionEnvInfo = {
    platform: process.platform,
    cwd: rootDir,
    shell: declaredShell(bashConfig?.shellPath),
    today: new Date().toISOString().slice(0, 10),
  };
  const projectDocsHolder: { value: string[] } = { value: await collectProjectDocs(rootDir, process.cwd()) };
  const skillsHolder: { value: SkillMetadata[] } = { value: skills };
  const buildFragment = (): string =>
    buildContextFragment(sessionEnv, config.systemPrompt, skillsHolder.value, projectDocsHolder.value);
  const seedContextFragment = async (): Promise<void> => {
    const seed: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: buildFragment() };
    messages.push(seed);
    await session.append(seed);
  };
  if (!opts.resumeFile) await seedContextFragment();

  /**
   * Reload project docs + skills for a workspace switch (/new after workspace
   * change, or session restore from another workspace). The fragment closures
   * read from mutable holders so the next seedContextFragment reflects the new
   * workspace — buildFragment itself stays a stable closure.
   */
  const reloadWorkspaceContext = async (dir: string): Promise<SkillMetadata[]> => {
    projectDocsHolder.value = await collectProjectDocs(dir, process.cwd());
    skillsHolder.value = await loadSkills([
      { dir: path.join(dir, NOVA_DIR, 'skills'), level: 'project' },
      { dir: path.join(os.homedir(), '.nova', 'skills'), level: 'user' },
    ]);
    return skillsHolder.value;
  };

  const systemPrompt = buildSystemPrompt();

  return {
    session,
    messages,
    client,
    host,
    skills,
    sessionEnv,
    projectDocs: projectDocsHolder.value,
    jobs,
    stats,
    approvalMode,
    bashConfig,
    codeConfig,
    spillReadRoot,
    buildFragment,
    seedContextFragment,
    reloadWorkspaceContext,
    systemPrompt,
  };
}
