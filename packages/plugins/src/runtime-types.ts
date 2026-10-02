/**
 * The `Kernel` handle a surface CONSUMES (and the roster rows it reports).
 *
 * Split from the assembly INPUT (`runtime-assembly.ts`: `KernelConfig` +
 * `CreateKernelOptions`) because the two are read by different code — the input
 * by whoever calls `createAgentKernel`, this by every caller of the handle —
 * and the file had outgrown the structure budget holding both. The input types
 * are re-exported below so `runtime-types.js` stays the one seam importers use.
 */
import type {
  AgentHooks,
  AgentSession,
  JobRegistry,
  LlmService,
  ModelControl,
  PtcMode,
  SessionEnvInfo,
} from '@nova-agent/core';
import type { CommandSummary } from './kernel-commands.js';
import type { PermissionService } from './permission.js';
import type { PluginTier } from './plugin-tier.js';
import type { SkillMetadata } from './skills.js';
import type { PluginHost } from './host.js';

export type { CreateKernelOptions, KernelConfig } from './runtime-assembly.js';

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
  /**
   * The skills in force (discovery minus `skillsDisable`). This is the list the
   * `<available_skills>` fragment and the `skill` tool are built from.
   */
  readonly skills: SkillMetadata[];
  /**
   * Every DISCOVERED skill, switched-off ones included. A management surface
   * reads this, never `skills`: a disabled skill is absent from `skills` by
   * definition, so listing from there would let a reader switch a skill off and
   * then lose the row that switches it back on.
   */
  readonly allSkills: SkillMetadata[];
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
   * Flip one plugin's switch: rewrites the durable `plugins.disable` list (via
   * the surface's persister) and re-rosters in place. Returns the names now
   * disabled. Throws for unknown names and for names the roster cannot safely
   * drop (see `NON_DISABLABLE_PLUGINS`).
   */
  setPluginEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
  /**
   * Flip one skill's switch: rewrites the durable `skills.disable` list and
   * reloads the skill index in place. Returns the names now disabled. Throws
   * for unknown skill names.
   */
  setSkillEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
  /**
   * The names currently switched off, as a management surface lists them.
   * Read-only: the switch methods above are the only writers and they return the
   * same list, so a panel never has to derive switch state from its own rows.
   */
  readonly disabled: { readonly plugins: readonly string[]; readonly skills: readonly string[] };
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
  /**
   * Whether the plugin is currently loaded (`plugins.disable` subtracts it).
   * Always true for rows the container knows — a disabled plugin leaves no
   * fiber, so its row comes from the manifest instead (see `describePlugins`).
   */
  enabled: boolean;
  /**
   * Where the plugin came from: a built-in (`builtin`), an extension package
   * loaded by spec (`extension`), a third-party module (`extra`), a capability
   * provider (`capability`), or the surface's own assembly (`surface`). The
   * settings panel groups rows by this.
   */
  origin: PluginOrigin;
  /**
   * Which layer this plugin belongs to — the manager's grouping axis and the
   * switch's ceiling. `core` rows get no switch at all (see `plugin-tier.ts`);
   * `advanced` rows are off until `plugins.enable` names them.
   */
  tier: PluginTier;
  /** The Chinese display name (`fs-read` → 「读取文件」); never the identifier. */
  title: string;
  /**
   * The row's one-line description: the Chinese label when this build has one,
   * else the plugin's own MODEL-facing description. Optional because a
   * third-party plugin with no label and no description has neither.
   */
  description?: string;
  /**
   * Why an ENABLED extension has no fiber: its package could not be loaded
   * (module missing / bad export). Absent for every other row — a plugin that
   * loaded, or one that is simply off, has no error to report.
   */
  error?: string;
  /**
   * The plugin's BROWSER-side bundle, when it ships one. Absent means the
   * plugin is server-only (the common case — most plugins extend the kernel
   * container with tools/services and need nothing in the browser beyond what
   * the host already ships). A plugin that contributes UI capabilities
   * (fence renderers, genui panels) declares where its client bundle is served
   * so the browser loader can fetch and register it on boot.
   *
   * `rev` rides the boot graph: a plugin rebuild bumps it, which busts the
   * loader's per-entry memo together with the host's immutable asset caching.
   * The path is served by the host's `RouteRegistry` under the same prefix
   * (`/plugins/<name>/client.js`) — the loader builds that URL from the
   * plugin's name, so the bundle is discoverable without a separate manifest.
   */
  clientBundle?: {
    /** Path under the plugin's `/plugins/<name>/` prefix; defaults to `client.js`. */
    path?: string;
    /** Content rev (a hash or version string) for cache busting. */
    rev?: string;
  };
}

/** Where a roster row came from (the plugin manager's grouping axis). */
export type PluginOrigin = 'builtin' | 'surface' | 'extra' | 'extension' | 'capability';

/**
 * One known plugin, loaded or not: the row the plugin manager draws. Loaded
 * plugins are reported by the container; disabled ones have no fiber, so the
 * assembly keeps their names + origins to report them anyway — otherwise a
 * turned-off plugin would vanish from the very page that turns it back on.
 */
export interface PluginDescriptor {
  name: string;
  origin: PluginOrigin;
  /** Which layer the plugin belongs to — see `PluginRosterEntry.tier`. */
  tier: PluginTier;
  /** The Chinese display name; see `PluginRosterEntry.title`. */
  title: string;
  /** The row's one-line description; see `PluginRosterEntry.description`. */
  description?: string;
  /** Why an enabled extension could not load; see `PluginRosterEntry.error`. */
  error?: string;
}
