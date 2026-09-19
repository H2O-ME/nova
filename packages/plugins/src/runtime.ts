/**
 * `createAgentKernel` — the one assembly point between the core kernel and
 * the plugin world (moved out of the CLI shell for M11: the TUI, the WebUI,
 * the bot channel and the headless runners all drive THIS, so no surface can
 * drift from the others).
 *
 * What it wires: the plugin host (built-ins with bash/code/subagent/skills
 * config, extra surface-side plugins), the permission engine over an
 * `ApprovalBroker` (asks ride the kernel event stream), the shared
 * `JobRegistry`, the session-start context fragment, and `AgentSession`
 * handles — each with its own durable log and live surface, while host,
 * permission and jobs stay shared (workspace/mode rebuilds re-point them).
 *
 * The provider is injected (core defines the `ChatProvider` contract; only
 * the CLI/web shells build one from config) — the same seam that keeps the
 * loop provider-agnostic now keeps the assembly surface-agnostic.
 */
import path from 'node:path';
import {
  AgentSession,
  buildContextFragment,
  compactSession,
  errMessage,
  JobRegistry,
  localDateKey,
  NOVA_DIR,
  novaHome,
  toolOutputsDir,
  wrapAutoCompact,
  type AgentHooks,
  type ChatProvider,
  type PtcMode,
  type SessionEnvInfo,
  type SubagentProgress,
} from '@nova-agent/core';
import { builtinPlugins } from './builtin/index.js';
import { resolveShellName } from './builtin/bash.js';
import { collectProjectDocs } from './agents-md.js';
import { loadSkills, skillsPlugin, type SkillMetadata } from './skills.js';
import { PluginHost } from './host.js';
import { buildSystemPrompt } from './system-prompt.js';
import type { Plugin } from './types.js';
import type { CreateKernelOptions, Kernel, KernelConfig } from './runtime-types.js';
import { makeApprovalWiring, openAgentSession } from './runtime-session.js';
export type { CreateKernelOptions, Kernel, KernelConfig } from './runtime-types.js';

/** The built-in roster for one host build (config expansion lives here once). */
function kernelPlugins(
  host: PluginHost,
  p: {
    provider: ChatProvider;
    config: KernelConfig;
    extraPlugins?: Plugin[];
    workspace?: { onChange: (dir: string) => void | Promise<void> };
    onSubagentProgress?: (progress: SubagentProgress) => void;
    systemPrompt: string;
    rootDir: () => string;
    codeMode: () => PtcMode;
    hooks: () => AgentHooks;
    shellPath: string | undefined;
  },
): Plugin[] {
  const { config } = p;
  return [
    ...(p.extraPlugins ?? []),
    ...builtinPlugins({
      spillReadRoot: toolOutputsDir(),
      ...(p.workspace !== undefined ? { workspace: p.workspace } : {}),
      subagent: {
        provider: p.provider,
        tools: () => host.tools,
        hooks: p.hooks,
        systemPrompt: p.systemPrompt,
        ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
        rootDir: p.rootDir,
        ...(p.onSubagentProgress !== undefined ? { onProgress: p.onSubagentProgress } : {}),
      },
      bash:
        config.bash === false
          ? false
          : {
              ...(config.bash?.timeoutMs !== undefined ? { timeoutMs: config.bash.timeoutMs } : {}),
              ...(p.shellPath !== undefined ? { shellPath: p.shellPath } : {}),
            },
      ...(config.code !== undefined ? { code: { ...config.code, mode: p.codeMode() } } : {}),
    }),
  ];
}

/**
 * Headless single-run auto-compact: gate every outgoing request (the old
 * `wrapHeadlessAutoCompact` contract — splice in place, never kill the run),
 * reports as kernel notices on the CURRENT session.
 */
function wrapHeadlessCompact(
  hooks: AgentHooks,
  p: {
    provider: ChatProvider;
    limit: number;
    currentSession: () => AgentSession | undefined;
    notice: (code: 'compact_failed' | 'compact_fused' | 'compact_alias_broken', text: string) => void;
  },
): void {
  wrapAutoCompact(hooks, {
    enabled: true,
    limit: p.limit,
    compact: async (msgs) => {
      const session = p.currentSession()?.session;
      if (session === undefined) return;
      const outcome = await compactSession({ client: p.provider, session, messages: msgs, trigger: 'auto' });
      // In-place: runAgent and the agent share this array.
      msgs.splice(0, msgs.length, ...outcome.surface);
    },
    onError: (err) => p.notice('compact_failed', `自动压缩失败（继续运行）：${errMessage(err)}`),
    onWarn: (code, text) => p.notice(code, text),
  });
}

export async function createAgentKernel(opts: CreateKernelOptions): Promise<Kernel> {
  const { provider, config } = opts;
  let rootDir = opts.rootDir;
  let codeMode: PtcMode = config.code?.mode ?? 'native';
  let skills: SkillMetadata[] = [];
  let projectDocs: string[] = [];
  let host!: PluginHost;
  let hooks!: AgentHooks;
  let current: AgentSession | undefined;

  const systemPrompt = opts.systemPrompt ?? buildSystemPrompt();
  const jobs = new JobRegistry();
  const shellPath = typeof config.bash === 'object' ? config.bash.shellPath : undefined;

  const sessionEnv = (): SessionEnvInfo => ({
    platform: process.platform,
    cwd: rootDir,
    shell: resolveShellName(shellPath),
    // Local timezone (matches the session date bucket); the old UTC slice
    // reported "yesterday" for every evening run west of the meridian.
    today: localDateKey().join('-'),
  });
  const buildFragment = (): string =>
    buildContextFragment(sessionEnv(), config.userInstructions, skills, projectDocs);

  const { bridge, permission } = makeApprovalWiring({
    approval: config.approval,
    host: () => host,
    rootDir: () => rootDir,
    current: () => current,
  });

  /**
   * Host assembly (single source): built-ins with the surface's extra plugins,
   * subagent wiring onto the LIVE composed hooks, skills projection. The
   * headless per-request compact wrap is applied once per composition — a
   * rebuild re-wraps fresh, never on top of a previous wrapper.
   */
  const rebuild = async (): Promise<void> => {
    const next = new PluginHost(rootDir);
    for (const plugin of kernelPlugins(next, {
      provider,
      config,
      extraPlugins: opts.extraPlugins,
      workspace: opts.workspace,
      onSubagentProgress: opts.onSubagentProgress,
      systemPrompt,
      rootDir: () => rootDir,
      codeMode: () => codeMode,
      hooks: () => hooks,
      shellPath,
    })) {
      next.use(plugin);
    }
    if (skills.length > 0) next.use(skillsPlugin(skills));
    await next.activate();
    host = next;
    hooks = next.agentHooks(permission);
    if (config.autoCompactTokenLimit !== undefined && opts.perRequestCompact === true) {
      wrapHeadlessCompact(hooks, {
        provider,
        limit: config.autoCompactTokenLimit,
        currentSession: () => current,
        notice: (code, text) => current?.notice(code, text),
      });
    }
  };

  /** Project + user skills and the AGENTS.md chain for a workspace root. */
  const loadWorkspaceContext = async (dir: string): Promise<SkillMetadata[]> => {
    projectDocs = await collectProjectDocs(dir, process.cwd());
    skills = await loadSkills([
      { dir: path.join(dir, NOVA_DIR, 'skills'), level: 'project' },
      { dir: path.join(novaHome(), 'skills'), level: 'user' },
    ]);
    return skills;
  };

  const newAgentSession: Kernel['newAgentSession'] = async (sessionOpts) => {
    const agent = await openAgentSession(
      {
        provider,
        config,
        systemPrompt,
        bridge,
        permission,
        jobs,
        rootDir: () => rootDir,
        host: () => host,
        hooks: () => hooks,
        buildFragment,
        perRequestCompact: opts.perRequestCompact === true,
      },
      sessionOpts,
    );
    current = agent;
    // Latest active session receives live job transitions (single-surface v1).
    jobs.setListener((job) => current?.observeJob(job));
    return agent;
  };

  await loadWorkspaceContext(rootDir);
  await rebuild();
  await newAgentSession(
    opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : { sessionDir: opts.sessionDir },
  );

  return {
    get agent() {
      if (current === undefined) throw new Error('kernel has no active session');
      return current;
    },
    get hooks() {
      return hooks;
    },
    get host() {
      return host;
    },
    permission,
    jobs,
    get skills() {
      return skills;
    },
    systemPrompt,
    rootDir: () => rootDir,
    sessionEnv,
    buildFragment,
    codeMode: () => codeMode,
    newAgentSession,
    activateSession: (agent) => {
      current = agent;
      jobs.setListener((job) => current?.observeJob(job));
    },
    setWorkspace: async (dir) => {
      rootDir = dir;
      skills = await loadWorkspaceContext(dir);
      await rebuild();
      return skills;
    },
    setCodeMode: async (mode) => {
      codeMode = mode;
      await rebuild();
    },
  };
}
