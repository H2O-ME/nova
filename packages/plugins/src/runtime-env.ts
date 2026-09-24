/**
 * The assembly environment: the container, the mutable parts a workspace or
 * mode change re-points, and the closures every other assembly file reads.
 *
 * Split from `runtime.ts` so the factory body stays readable and the shared
 * shape (what the roster and the façade are allowed to touch) is declared in
 * exactly one place. Everything here is created once per kernel.
 */
import path from 'node:path';
import {
  buildContextFragment,
  compaction as compactionKey,
  Context,
  llm as llmKey,
  JobRegistry,
  localDateKey,
  NOVA_DIR,
  novaHome,
  sessions as sessionsKey,
  spill as spillKey,
  tools as toolsKey,
  type AgentHooks,
  type AgentSession,
  type ApprovalBroker,
  type ChatProvider,
  type CompactedSession,
  type CompactSessionOptions,
  type PtcMode,
  type SessionEnvInfo,
} from '@nova-agent/core';
import { collectProjectDocs } from './agents-md.js';
import { resolveShellName } from './builtin/bash.js';
import { PluginHost } from './host.js';
import { composeHooks } from './hooks.js';
import { buildSystemPrompt } from './system-prompt.js';
import { loadSkills, type SkillMetadata } from './skills.js';
import type { CreateKernelOptions } from './runtime-types.js';
import { makeApprovalWiring, openAgentSession, type PermissionService } from './runtime-session.js';
import {
  approvalProvider,
  compactionProvider,
  jobsProvider,
  llmProvider,
  sessionsProvider,
  skillsProvider,
  spillProvider,
} from './services.js';

/** What the assembly mutates: the parts a workspace/mode change re-points. */
export interface State {
  rootDir: string;
  codeMode: PtcMode;
  projectDocs: string[];
  skills: SkillMetadata[];
  host: PluginHost | undefined;
}

/** The assembled pieces every other assembly file reaches for. */
export interface Environment {
  root: Context;
  state: State;
  jobs: JobRegistry;
  provider: ChatProvider;
  bridge: ApprovalBroker;
  permission: PermissionService;
  systemPrompt: string;
  sessionEnv(): SessionEnvInfo;
  buildFragment(): string;
  hooks(): AgentHooks;
  /** Re-scan docs + skills for the current workspace root. */
  loadWorkspace(): Promise<SkillMetadata[]>;
  /** The session FACTORY (what the `sessions` provider calls). */
  openSession(sessionOpts?: { resumeFile?: string; sessionDir?: string }): Promise<AgentSession>;
  /** Open through the service, which is what makes it the current session. */
  openCurrent(sessionOpts?: { resumeFile?: string; sessionDir?: string }): Promise<AgentSession>;
  /** Rebuild the tool host + roster for the current workspace/mode. */
  reroster(): Promise<void>;
}

/** Build the container, publish the capability providers, wire the closures. */
export function createEnvironment(opts: CreateKernelOptions): Environment {
  const { provider, config } = opts;
  const root = Context.createRoot();
  const jobs = new JobRegistry();
  const systemPrompt = opts.systemPrompt ?? buildSystemPrompt();
  const shellPath = typeof config.bash === 'object' ? config.bash.shellPath : undefined;
  const state: State = {
    rootDir: opts.rootDir,
    codeMode: config.code?.mode ?? 'native',
    projectDocs: [],
    skills: [],
    host: undefined,
  };

  const { bridge, permission } = makeApprovalWiring({
    approval: config.approval,
    rootDir: () => state.rootDir,
    tools: () => root.get(toolsKey),
    current: () => root.get(sessionsKey)?.current(),
  });

  const env: Environment = {
    root,
    state,
    jobs,
    provider,
    bridge,
    permission,
    systemPrompt,
    sessionEnv: () => ({
      platform: process.platform,
      cwd: state.rootDir,
      shell: resolveShellName(shellPath),
      // Local date, matching the session bucket: a UTC slice calls every
      // evening run west of the meridian "yesterday".
      today: localDateKey().join('-'),
    }),
    buildFragment: () =>
      buildContextFragment(env.sessionEnv(), config.userInstructions, state.skills, state.projectDocs),
    hooks: () => composeHooks(root),
    loadWorkspace: () => loadWorkspace(env),
    openSession: (sessionOpts) => openSession(env, opts, sessionOpts),
    openCurrent: (sessionOpts) => root.must(sessionsKey).open(sessionOpts),
    reroster: () => reroster(env, opts),
  };

  // ── capability providers: one plugin per seam, replaceable by key ────────
  root.plugin(approvalProvider(permission), {}, 'approval');
  root.plugin(llmProvider({ provider, model: opts.model ?? '' }), {}, 'llm');
  root.plugin(jobsProvider(jobs), {}, 'jobs');
  root.plugin(spillProvider(), {}, 'spill');
  root.plugin(compactionProvider(), {}, 'compaction');
  root.plugin(skillsProvider(() => state.skills, () => loadWorkspace(env)), {}, 'skills');
  root.plugin(sessionsProvider(env.openSession), {}, 'sessions');
  return env;
}

/** Open one durable session handle over the live services. */
async function openSession(
  env: Environment,
  opts: CreateKernelOptions,
  sessionOpts?: { resumeFile?: string; sessionDir?: string },
): Promise<AgentSession> {
  const llm = env.root.must(llmKey);
  const agent = await openAgentSession(
    {
      config: opts.config,
      systemPrompt: env.systemPrompt,
      bridge: env.bridge,
      permission: env.permission,
      provider: llm.provider,
      rootDir: () => env.state.rootDir,
      tools: () => [...env.root.must(toolsKey).all()],
      hooks: env.hooks,
      jobs: env.jobs,
      buildFragment: env.buildFragment,
      cacheDir: (sessionId) => env.root.must(spillKey).dir(sessionId),
      compact: (options: CompactSessionOptions): Promise<CompactedSession> =>
        env.root.must(compactionKey).run(options),
      perRequestCompact: opts.perRequestCompact === true,
    },
    sessionOpts,
  );
  // Affinity is bound by the sessions provider (open AND activate), so this
  // factory only has to hand back a live handle.
  env.jobs.setListener((job) => env.root.get(sessionsKey)?.current()?.observeJob(job));
  return agent;
}

/** Project + user skills and the AGENTS.md chain for the current root. */
async function loadWorkspace(env: Environment): Promise<SkillMetadata[]> {
  const dir = env.state.rootDir;
  env.state.projectDocs = await collectProjectDocs(dir, process.cwd());
  env.state.skills = await loadSkills([
    { dir: path.join(dir, NOVA_DIR, 'skills'), level: 'project' },
    { dir: path.join(novaHome(), 'skills'), level: 'user' },
  ]);
  return env.state.skills;
}

/**
 * The roster module reads the environment TYPE from here; this file reads its
 * `reroster` value — a one-way runtime edge with a type-only import back, so
 * there is no evaluation cycle.
 */
import { reroster } from './runtime-roster.js';
