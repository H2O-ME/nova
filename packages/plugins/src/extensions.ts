/**
 * The EXTENSION plugins: the `advanced` tier rows that ship as their OWN
 * packages (one module specifier each) instead of living inside this one.
 *
 * The mandate (2026-10-01): base capabilities stay with the main program;
 * extension capabilities are third-party-like — loaded by specifier, and a
 * MISSING module must not take the app down. So:
 *
 *  - a module is imported ONLY when its row is enabled (a disabled or absent
 *    extension costs nothing);
 *  - one enabled-but-unloadable extension degrades to a warning + a roster row
 *    carrying `error` — boot and re-roster continue, the same posture a
 *    PLUGIN-owned config section takes in `cli/config-expand.ts`;
 *  - the spec table is DATA, overridable per kernel (`CreateKernelOptions.
 *    extensionSpecs`) so tests can simulate an absent module and an operator
 *    can swap an implementation without touching source.
 *
 * The packages are dependencies of THIS package (distribution), never source
 * imports — `dep-direction.mjs` scans this package's source and finds no
 * reference to any of them, exactly like dsh's launcher lists bundles without
 * importing them.
 */
import { errMessage, sessions as sessionsKey, tools as toolsKey } from '@nova-agent/core';
import type { AgentHooks, ChatProvider, Plugin, SubagentProgress, ToolDefinition } from '@nova-agent/core';
import { labelFor, pluginTier } from './plugin-tier.js';
import { resolveModuleSpec } from './module-spec.js';
import type { CodeModeConfig, CreateKernelOptions } from './runtime-assembly.js';
import type { PluginDescriptor } from './runtime-types.js';
import type { Environment } from './runtime-env.js';

/**
 * Name → module specifier. Object order IS load order, and it is load-bearing:
 * `subagent` before `ptc`, because a PTC-mode SDK projection must already
 * include the subagent tool (the old builtin array had the same constraint).
 */
export const EXTENSION_SPECS: Readonly<Record<string, string>> = {
  subagent: '@nova-agent/plugin-subagent',
  context: '@nova-agent/plugin-context',
  ptc: '@nova-agent/plugin-ptc',
};

/** One enabled extension whose module could not be loaded (the row carries the message). */
export interface ExtensionFailure {
  name: string;
  error: string;
}

export interface ExtensionLoad {
  /** Loaded extension plugins, in spec-table order. */
  plugins: Plugin[];
  /** Enabled extensions that failed to load — reported, never fatal. */
  failed: ExtensionFailure[];
}

/**
 * Load every ENABLED extension from its specifier.
 *
 * A failure is caught PER NAME: the other extensions, the base roster and the
 * rest of the product are unaffected. The caller turns `failed` into manifest
 * rows (`extensionDescriptor(name, error)`) so the panel can show why a switch
 * that is on has no fiber.
 *
 * @param enabled - extension names in force (`enabledByTier`, derived opt-ins included).
 * @param env - the live environment (kernel facts the factories consume).
 * @param opts - the assembly options (config + `extensionSpecs` override).
 * @returns the loaded plugins and the per-name failures.
 */
export async function loadExtensions(
  enabled: readonly string[],
  env: Environment,
  opts: CreateKernelOptions,
): Promise<ExtensionLoad> {
  const specs: Readonly<Record<string, string>> = { ...EXTENSION_SPECS, ...opts.extensionSpecs };
  const plugins: Plugin[] = [];
  const failed: ExtensionFailure[] = [];
  for (const name of extensionNames()) {
    if (!enabled.includes(name)) continue;
    const spec = specs[name] ?? EXTENSION_SPECS[name];
    if (spec === undefined) continue; // only known extension names are honoured
    try {
      const module = (await import(resolveModuleSpec(spec, process.cwd()))) as Record<string, unknown>;
      plugins.push(createExtension(name, module, env, opts));
    } catch (err) {
      failed.push({ name, error: errMessage(err) });
    }
  }
  return { plugins, failed };
}

/** The extension names (spec-table keys), in load order. */
export function extensionNames(): string[] {
  return Object.keys(EXTENSION_SPECS);
}

/**
 * The manifest row every extension always has — loaded, disabled, or failed.
 * `error` is set only for an enabled load that failed; the row then renders as
 * off-with-a-reason instead of a switch that silently does nothing.
 */
export function extensionDescriptor(name: string, error?: string): PluginDescriptor {
  const label = labelFor(name);
  return {
    name,
    origin: 'extension',
    tier: pluginTier(name),
    title: label.title,
    ...(label.description.length > 0 ? { description: label.description } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

/** Build one extension's plugin from its loaded module (per-name factory adapter). */
function createExtension(
  name: string,
  module: Record<string, unknown>,
  env: Environment,
  opts: CreateKernelOptions,
): Plugin {
  switch (name) {
    case 'subagent': {
      const factory = module['subagentPlugin'];
      if (typeof factory !== 'function') throw new Error('module does not export subagentPlugin');
      return (factory as (options: SubagentOptions) => Plugin)(subagentOptions(env, opts));
    }
    case 'context': {
      const plugin = module['contextPlugin'];
      if (typeof plugin !== 'object' || plugin === null || typeof (plugin as { apply?: unknown }).apply !== 'function') {
        throw new Error('module does not export a contextPlugin plugin object');
      }
      return plugin as Plugin;
    }
    case 'ptc': {
      const factory = module['ptcPlugin'];
      if (typeof factory !== 'function') throw new Error('module does not export ptcPlugin');
      return (factory as (options: CodeModeConfig) => Plugin)(ptcOptions(env, opts));
    }
    default:
      throw new Error(`no loader is registered for extension "${name}"`);
  }
}

/** The live kernel facts the subagent factory consumes. */
interface SubagentOptions {
  provider: ChatProvider;
  tools: () => ToolDefinition[];
  hooks: () => AgentHooks | undefined;
  systemPrompt: string;
  maxTurns?: number;
  rootDir: () => string;
  onProgress: (progress: SubagentProgress) => void;
}

/**
 * The subagent wiring, moved here from `runtime-builtins.ts` when the plugin
 * left the package — the facts are the same, so the derived behaviour is too.
 *
 * `onProgress` stays wired at the assembly point for the reason jobs are
 * (`runtime-env.ts`'s `jobs.setListener`): a delegation's lifecycle is a kernel
 * fact every surface wants, and leaving it to callers meant it was never
 * supplied. A surface-provided callback still wins.
 */
function subagentOptions(env: Environment, opts: CreateKernelOptions): SubagentOptions {
  return {
    provider: env.provider,
    tools: () => [...env.root.must(toolsKey).all()],
    hooks: env.hooks,
    systemPrompt: env.systemPrompt,
    ...(opts.config.maxTurns !== undefined ? { maxTurns: opts.config.maxTurns } : {}),
    rootDir: () => env.state.rootDir,
    onProgress:
      opts.onSubagentProgress ??
      ((progress) => { env.root.get(sessionsKey)?.current()?.observeSubagent(progress); }),
  };
}

/**
 * The PTC mode in force, over the configured options. `native` becomes `both`
 * here because under pure `native` presentation the plugin would be a no-op
 * rather than an opt-in-capable row; the operator who turned PTC on through
 * `setCodeMode` gets their real mode from the live state instead.
 */
function ptcOptions(env: Environment, opts: CreateKernelOptions): CodeModeConfig {
  return { ...opts.config.code, mode: env.state.codeMode === 'native' ? 'both' : env.state.codeMode };
}
