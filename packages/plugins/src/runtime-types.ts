/**
 * Kernel assembly types (M11): the config slice, the factory options and the
 * `Kernel` bundle every surface consumes. Split from `runtime.ts` so the
 * factory body stays under the structure budget and the contract reads alone.
 */
import type {
  AgentHooks,
  AgentSession,
  ChatProvider,
  JobRegistry,
  PtcMode,
  SessionEnvInfo,
  SubagentProgress,
} from '@nova-agent/core';
import type { BuiltinOptions } from './builtin/index.js';
import type { ApprovalMode, PermissionService } from './permission.js';
import type { SkillMetadata } from './skills.js';
import type { PluginHost } from './host.js';
import type { Plugin } from './types.js';

/** The surface-independent slice of `~/.nova/config.json` the kernel needs. */
export interface KernelConfig {
  approval: ApprovalMode;
  /** config.systemPrompt — appended session directives, not the persona. */
  userInstructions?: string;
  maxTurns?: number;
  autoCompactTokenLimit?: number;
  /** false disables bash; object tunes it (mirrors config.tools.bash). */
  bash?: false | { timeoutMs?: number; shellPath?: string };
  /** PTC config (mirrors config.tools.code); mode drives the tool projection. */
  code?: BuiltinOptions['code'];
}

export interface CreateKernelOptions {
  rootDir: string;
  provider: ChatProvider;
  config: KernelConfig;
  /** Resume an existing JSONL log for the FIRST session handle. */
  resumeFile?: string;
  /** Plugins the owning surface contributes (e.g. the qqbot send tool). */
  extraPlugins?: Plugin[];
  /**
   * Wires the model-facing `switch_workspace` tool. Provide the runner-side
   * callback (which typically calls `kernel.setWorkspace` plus its own
   * feedback); omit to leave the tool unregistered (headless exec).
   */
  workspace?: { onChange: (dir: string) => void | Promise<void> };
  /** Nested-subagent visibility feed (live rows). Best-effort, may be unset. */
  onSubagentProgress?: (progress: SubagentProgress) => void;
  /**
   * Headless single-run mode: one run spans the whole task, so auto-compact
   * gates inside every request (wrapAutoCompact) instead of at boundaries.
   */
  perRequestCompact?: boolean;
  /** Persona override; defaults to the shipped static prompt. */
  systemPrompt?: string;
  /** Session-file bucket override (qqbot archives under sessionsRoot()/qqbot). */
  sessionDir?: string;
}

export interface Kernel {
  /** The CURRENT AgentSession handle (audit/job fan-out/per-request compact target). */
  readonly agent: AgentSession;
  /** The composed hook chain of the current host (subagent nesting shares it). */
  readonly hooks: AgentHooks;
  readonly host: PluginHost;
  readonly permission: PermissionService;
  readonly jobs: JobRegistry;
  readonly skills: SkillMetadata[];
  readonly systemPrompt: string;
  rootDir(): string;
  sessionEnv(): SessionEnvInfo;
  /** The session-start context fragment for the CURRENT workspace. */
  buildFragment(): string;
  /** Current effective PTC mode (config default unless setCodeMode ran). */
  codeMode(): PtcMode;
  /**
   * Create another AgentSession on this kernel's wiring (its own log + live
   * surface; shared host/permission/jobs) and make it current — `/new`,
   * session switch, qqbot per-peer sessions.
   */
  newAgentSession(opts?: { resumeFile?: string; sessionDir?: string }): Promise<AgentSession>;
  /** Make an existing session current again (qqbot peer turn switch). */
  activateSession(agent: AgentSession): void;
  /** Re-point the tool root + docs + skills + host at another directory. */
  setWorkspace(dir: string): Promise<SkillMetadata[]>;
  /** Rebuild the host with another PTC mode (approval grants persist). */
  setCodeMode(mode: PtcMode): Promise<void>;
}
