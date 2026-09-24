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
  LlmService,
  ModelCatalogPort,
  ModelControl,
  PtcMode,
  SessionEnvInfo,
  SubagentProgress,
} from '@nova-agent/core';
import type { BuiltinOptions } from './builtin/index.js';
import type { CommandSummary } from './kernel-commands.js';
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
  /**
   * Which plugins load. `disable` names built-ins to leave out (the name is the
   * plugin's own, as `/plugins` prints it); `extra` lists modules to load
   * instead, by absolute path, path relative to the working directory, or bare
   * package name — each must export a plugin as `default` (or `plugin`).
   *
   * This is the config-level extension point: an operator changes what the
   * product does without editing source, and a typo fails the boot loudly
   * instead of silently doing nothing.
   */
  plugins?: { disable?: readonly string[]; extra?: readonly string[] };
}

export interface CreateKernelOptions {
  rootDir: string;
  provider: ChatProvider;
  config: KernelConfig;
  /** Model id as the endpoint knows it — published on the `llm` service. */
  model?: string;
  /**
   * Model metadata for the picker (display names + context windows). Omitting
   * it means "no picker": the kernel then offers no `models` control, and a
   * surface that would render a model seat simply does not. The model IDS are
   * not part of this port — they come from the endpoint itself
   * (`ChatProvider.listModels`), so a gateway that adds a model needs no
   * release from this product.
   */
  modelCatalog?: ModelCatalogPort;
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
  /** The composed hook chain of the current roster (subagent nesting shares it). */
  readonly hooks: AgentHooks;
  readonly host: PluginHost;
  /** The model end: provider + model id + cache affinity (a capability seam). */
  readonly llm: LlmService;
  /**
   * The model picker's handle — present only when the assembly was given a
   * `modelCatalog` AND the provider can retarget (`ChatProvider.setModel`).
   * Absent means the seat should not render at all, rather than render dead.
   */
  readonly models?: ModelControl;
  /**
   * Every slash command the kernel can run **on itself**, live from the
   * registry — first-party and third-party alike, so a surface renders one menu
   * instead of keeping a catalog of its own. Commands that need a surface
   * affordance (a theme switch, an exit, the model picker) are NOT here: they
   * belong to the surface that can carry them out.
   */
  readonly commands: readonly CommandSummary[];
  /**
   * Run one by name. Reporting happens in the command's own transcript row
   * (`command` events), and an unknown name reports there too — the caller is
   * never left with a silent no-op or a thrown error to render.
   */
  runCommand(name: string, args: string): Promise<void>;
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
   * What is actually loaded right now: every plugin's name, state and declared
   * dependencies. This is the traceability surface — `/plugins` prints it, and
   * a boot that lost a capability is visible here instead of at the first call.
   */
  roster(): readonly PluginRosterEntry[];
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
  /** Unload every plugin (a clean shutdown; process exit is the usual path). */
  dispose(): Promise<void>;
}

/** One live plugin, as `/plugins` reports it. */
export interface PluginRosterEntry {
  name: string;
  state: string;
  inject: readonly string[];
}
