import path from 'node:path';
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  emptyStats,
  JobRegistry,
  newId,
  Session,
  type AgentHooks,
  type AgentMessage,
  type SubagentProgress,
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
import { localDateKey, NOVA_DIR, novaHome, sessionDateBucket, sessionsRoot, type Config } from './config.js';
import { buildContextFragment, CONTEXT_FRAGMENT_ID_PREFIX, declaredShell, type SessionEnvInfo } from './context.js';
import { recordSessionWorkspace } from './sessions.js';
import { buildSystemPrompt } from './system-prompt.js';

/** 一次插件宿主装配的入参：初始构建与 runner 侧 rebuild 共用同一工厂。 */
export interface HostBuildOptions {
  rootDir: string;
  /**
   * PTC 模式覆盖（TUI Tab 切换传当前值）；缺省回落 config 的
   * tools.code.mode。其余 tools.code 调参（超时/预算）每次装配原样带上。
   */
  codeMode?: import('@nova-agent/core').PtcMode;
  /** 技能列表（工作区切换后由 reloadWorkspaceContext 刷新后传入）。 */
  skills?: SkillMetadata[];
  /**
   * switch_workspace 的运行侧回调覆盖（默认用 createSessionRuntime 的
   * opts.workspace）。TUI 传带呈现反馈的版本。
   */
  workspace?: { onChange: (dir: string) => void | Promise<void> };
}

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
  /** Runner-assigned hook chain; read live by the subagent tool. */
  hooksRef: { current: AgentHooks | undefined };
  approvalMode: ApprovalMode;
  bashConfig: NonNullable<Config['tools']>['bash'] | undefined;
  codeConfig: NonNullable<Config['tools']>['code'] | undefined;
  spillReadRoot: string;
  /** Re-seed the context fragment for a fresh session (/new). */
  buildFragment: () => string;
  /**
   * Seed the context fragment into the GIVEN session/message surface.
   * Interactive runners rebind `session`/`messages` on /new and session
   * switch — after a rebind they MUST pass the current bindings here and
   * MUST NOT read `rt.session`/`rt.messages` (those still point at the old
   * session; the runtime has no visibility into runner-side rebinding).
   */
  seedContextFragment: (session: Session, messages: AgentMessage[]) => Promise<void>;
  /** Reload project docs + skills for a workspace switch. Returns updated skills. */
  reloadWorkspaceContext: (dir: string) => Promise<SkillMetadata[]>;
  /**
   * 插件宿主装配单源：初始 host 与 runner 侧 rebuild（TUI Tab 模式切换、
   * 工作区切换）走同一工厂——bash 配置展开、subagent 接线、extraPlugins
   * 挂载只有这一份。激活后返回；hooks 仍由 runner 侧用自有审批链派生。
   */
  buildHost: (build: HostBuildOptions) => Promise<PluginHost>;
  /** Stable-byte system prompt string. */
  systemPrompt: string;
}

export interface SessionRuntimeOptions {
  rootDir: string;
  config: Config;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
  /**
   * Wires the model-facing `switch_workspace` tool: the runner callback
   * re-points its tool host / skills / env at the new directory. Omit (or the
   * runner cannot honor a mid-run switch — headless exec) to leave the tool
   * unregistered.
   */
  workspace?: { onChange: (dir: string) => void | Promise<void> };
  /**
   * Visibility feed for nested subagent runs (live tool/usage rows). The
   * subagent plugin forwards nested lifecycle moments here; runners that
   * render the transcript (TUI/REPL) assign a live renderer. Optional and
   * fire-and-forget — core never depends on it.
   */
  subagentProgress?: (progress: SubagentProgress) => void;
  /**
   * Third-party plugins mounted into the host BEFORE activation (the
   * third-party authoring path: a package exporting Plugin objects — e.g.
   * @nova-agent/qqbot — wired by the runner that owns its lifecycle).
   */
  extraPlugins?: import('@nova-agent/plugins').Plugin[];
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
  /**
   * The runners' hook chain (approval gate + PTC projection), re-read live by
   * the subagent tool so nested calls pass the SAME gate. Runners assign it
   * whenever they (re)build hooks.
   */
  const hooksRef: { current: AgentHooks | undefined } = { current: undefined };
  const systemPrompt = buildSystemPrompt();

  const approvalMode = opts.approvalOverride ?? config.approval ?? 'read-only';

  const bashConfig = config.tools?.bash;
  const codeConfig = config.tools?.code;
  const spillReadRoot = path.join(novaHome(), 'cache', 'tool-outputs');

  /**
   * 插件宿主装配（单源）：内置插件、bash 配置展开、subagent 接线、code 模式
   * 与技能挂载全在这里。runner 侧的 rebuild（TUI Tab/工作区切换）传当前
   * rootDir/codeMode/skills 进来，不再各自重写装配。
   */
  const buildHost = async (build: HostBuildOptions): Promise<PluginHost> => {
    const host = new PluginHost(build.rootDir);
    const buildWorkspace = build.workspace ?? opts.workspace;
    for (const plugin of [...(opts.extraPlugins ?? []), ...builtinPlugins({
      spillReadRoot,
      ...(buildWorkspace !== undefined ? { workspace: buildWorkspace } : {}),
      subagent: {
        provider: client,
        tools: () => host.tools,
        hooks: () => hooksRef.current,
        systemPrompt,
        ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
        rootDir: () => build.rootDir,
        // Foreground + background nested runs share this feed (labels are not
        // unique, but the parent tool CALL binds the row — see tui-mode).
        ...(opts.subagentProgress !== undefined ? { onProgress: opts.subagentProgress } : {}),
      },
      bash:
        bashConfig?.enabled === false
          ? false
          : {
              ...(bashConfig?.timeoutMs !== undefined ? { timeoutMs: bashConfig.timeoutMs } : {}),
              ...(bashConfig?.shellPath !== undefined ? { shellPath: bashConfig.shellPath } : {}),
            },
      ...(codeConfig !== undefined
        ? { code: { ...codeConfig, mode: build.codeMode ?? codeConfig.mode ?? 'native' } }
        : {}),
    })]) {
      host.use(plugin);
    }
    const buildSkills = build.skills ?? skills;
    if (buildSkills.length > 0) host.use(skillsPlugin(buildSkills));
    await host.activate();
    return host;
  };

  const userSkillsDir = path.join(novaHome(), 'skills');
  const skills = await loadSkills([
    { dir: path.join(rootDir, NOVA_DIR, 'skills'), level: 'project' },
    { dir: userSkillsDir, level: 'user' },
  ]);
  const host = await buildHost({ rootDir, skills });

  const sessionEnv: SessionEnvInfo = {
    platform: process.platform,
    cwd: rootDir,
    shell: declaredShell(bashConfig?.shellPath),
    // Local timezone (matches the session date bucket); the old UTC slice
    // reported "yesterday" for every evening run west of the meridian.
    today: localDateKey().join('-'),
  };
  const projectDocsHolder: { value: string[] } = { value: await collectProjectDocs(rootDir, process.cwd()) };
  const skillsHolder: { value: SkillMetadata[] } = { value: skills };
  const buildFragment = (): string =>
    buildContextFragment(sessionEnv, config.systemPrompt, skillsHolder.value, projectDocsHolder.value);
  const seedContextFragment = async (target: Session, surface: AgentMessage[]): Promise<void> => {
    // The dedicated id prefix (not a plain msg_ id) lets compaction exclude
    // the fragment by id — see CONTEXT_FRAGMENT_ID_PREFIX.
    const seed: UserMessage = {
      id: newId(CONTEXT_FRAGMENT_ID_PREFIX.slice(0, -1)),
      ts: Date.now(),
      role: 'user',
      content: buildFragment(),
    };
    surface.push(seed);
    await target.append(seed);
  };
  if (!opts.resumeFile) await seedContextFragment(session, messages);

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
      { dir: userSkillsDir, level: 'user' },
    ]);
    return skillsHolder.value;
  };

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
    hooksRef,
    approvalMode,
    bashConfig,
    codeConfig,
    spillReadRoot,
    buildFragment,
    seedContextFragment,
    reloadWorkspaceContext,
    buildHost,
    systemPrompt,
  };
}
