/**
 * What a surface must SUPPLY to assemble a kernel: the config slice it derives
 * from `~/.nova/config.json` and the factory options it injects.
 *
 * Split from `runtime-types.ts` (which declares the `Kernel` handle a surface
 * CONSUMES) because the two are different contracts read by different code:
 * this one by whoever calls `createAgentKernel`, that one by every caller of
 * the resulting handle.
 */
import type { ChatProvider, ModelCatalogPort, Plugin, SubagentProgress, SurfaceRows } from '@nova-agent/core';
import type { BuiltinOptions } from './builtin/index.js';
import type { ApprovalMode } from './permission.js';

/** The surface-independent slice of `~/.nova/config.json` the kernel needs. */
export interface KernelConfig {
  approval: ApprovalMode;
  /** config.systemPrompt — appended session directives, not the persona. */
  userInstructions?: string;
  maxTurns?: number;
  autoCompactTokenLimit?: number;
  /**
   * Token budget for the injected AGENTS.md chain
   * (config.projectDocMaxTokens). Deployment-varying, so it is config rather
   * than a constant: a large operator handbook wants more than the default.
   */
  projectDocMaxTokens?: number;
  /** false disables bash; object tunes it (mirrors config.tools.bash). */
  bash?: false | { timeoutMs?: number; shellPath?: string };
  /** PTC config (mirrors config.tools.code); mode drives the tool projection. */
  code?: BuiltinOptions['code'];
  /**
   * Which plugins load. `disable` names plugins to leave out (the name is the
   * plugin's own, as `/plugins` prints it); `extra` lists modules to load
   * instead, by absolute path, path relative to the working directory, or bare
   * package name — each must export a plugin as `default` (or `plugin`).
   *
   * `enable` is the OTHER direction, and it exists because a default is not a
   * ceiling: an `advanced` plugin (`subagent` / `ptc` / `qqbot`) is off on a
   * fresh install, and this list is how an operator asks for it back. Writing
   * `disable` for that would be actively wrong — `disable` WINS over `enable`
   * (the safe side, see `enabledByTier`), so a name in both lists can never be
   * turned on again. The two lists are therefore disjoint by construction:
   * `disable` carries `standard` rows, `enable` carries `advanced` ones.
   *
   * This is the config-level extension point: an operator changes what the
   * product does without editing source, and a typo fails the boot loudly
   * instead of silently doing nothing.
   */
  plugins?: { disable?: readonly string[]; enable?: readonly string[]; extra?: readonly string[] };
  /**
   * Skills the Skill 中心 turned off (`skills.disable`): by name, both levels.
   * Applied where the index is built (the workspace loader), so a disabled
   * skill is absent from the `<available_skills>` block AND from the `skill`
   * tool — one rule, not two. A name matching nothing warns at assembly (the
   * `plugins.disable` typo discipline).
   */
  skillsDisable?: readonly string[];
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
   * Whether this surface has a person who can answer `ask_user_question`.
   *
   * Defaults to FALSE, and that default is the fail-closed one: an unattended run
   * (headless `exec`, the bot channel) that offered the tool an answerer would
   * park inside the ask until something aborted it, with no card on any surface to
   * release it. A surface that does have a human sets this, and its
   * `resolveQuestion` is what settles the wait.
   *
   * Set it ONLY when assembling for a surface the kernel cannot ask: the cli's
   * built-in entries (web / repl / qqbot / exec) are `SurfaceEntry`s, not
   * registry `AgentSurface`s, so they have no `answersQuestions` declaration to
   * read. A config-loaded surface goes through
   * `packages/cli/src/surface-host.ts`, which derives this from the surface's own
   * declaration instead — do not hand-copy it there.
   */
  userQuestions?: boolean;
  /**
   * Headless single-run mode: one run spans the whole task, so auto-compact
   * gates inside every request (wrapAutoCompact) instead of at boundaries.
   */
  perRequestCompact?: boolean;
  /** Persona override; defaults to the shipped static prompt. */
  systemPrompt?: string;
  /** Session-file bucket override (qqbot archives under sessionsRoot()/qqbot). */
  sessionDir?: string;
  /**
   * The surface's config writers for the settings panel's switches. Absent in
   * headless/test assemblies (whose config is not the operator's file): the
   * switch methods then throw instead of pretending to persist. The writers
   * patch the RAW document (never the expanded `Config`), so `{env:NAME}`
   * references survive a toggle. Lives beside the other surface injections
   * (`extraPlugins`, `workspace`, `onSubagentProgress`).
   */
  persistConfig?: {
    setPluginEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
    setSkillEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
    /**
     * Replace the `plugins.enable` list wholesale — the `advanced` half of the
     * two-list split (see `KernelConfig.plugins`). Optional so a surface that
     * predates it still assembles: an advanced flip then fails with a clear
     * "cannot persist" error rather than silently writing the wrong list.
     * @param names - the names that should be ON, sorted and de-duplicated.
     * @returns the enable list now in force.
     */
    setPluginEnabledList?(names: readonly string[]): Promise<readonly string[]>;
  };
  /**
   * The surfaces this kernel serves, as one bundle: the REGISTRY the resolver
   * reads/writes, and the surface implementations already loaded by the caller
   * (`loadSurfacePlugins`).
   *
   * The roster turns each one into an ordinary plugin ROW (`surfacePlugin`), so
   * a surface appears in `/plugins`, sits in the tier table and can be switched
   * off by name — the same shape every other capability has. The registry is
   * passed in rather than built here because it must outlive the kernel and be
   * shared by the resolver and the container service.
   *
   * `loaded` (not specs) because the caller has to import the modules anyway to
   * answer "which surface claims this invocation" — that is a pure predicate
   * over argv needing no kernel. Passing the loaded objects means ONE import and
   * one identity, so `registry.current()` and the plugin row are the same
   * object. Load them with the shared primitive (`loadSurfacePlugins`), never by
   * hand.
   */
  surfaces?: SurfaceRows;
}

