/**
 * Third-party plugin loading (`plugins.extra`): module spec resolution, name
 * normalization and the plugin-shape check. The ROSTER ASSEMBLY itself (what
 * loads, in what order, tier gating) lives in `runtime-roster.ts`; the pure
 * filtering half is re-exported from `roster-filter.ts`.
 *
 * Extra modules are loaded as the *public* plugin shape (`{ name, apply }`),
 * the same one the built-ins use. Container plugins with `inject` are the
 * kernel's own seams; a third party does not need them to add a tool, a command
 * or a hook.
 */
import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { errMessage, pluginName, type AnyPlugin, type Plugin } from '@nova-agent/core';

/**
 * The pure filtering half lives in `roster-filter.ts` (it is what the settings
 * panel asks on every flip, so it must need no module loading). Re-exported
 * here to keep this module the one import site for "the roster".
 */
export { loadableRoster, unknownDisabled, type RosterLists } from './roster-filter.js';

/**
 * Resolve a module spec the way plugins (and surfaces) load it: an absolute
 * path or one starting with `.` is made a file URL under the working directory,
 * a bare package name is returned as-is for Node to resolve. Shared with
 * `loadSurfacePlugins` so surface and kernel-plugin loading agree on what a
 * config string means — one resolution rule, not two.
 */
export function resolveModuleSpec(spec: string, cwd: string): string {
  return isAbsolute(spec) || spec.startsWith('.') ? pathToFileURL(resolve(cwd, spec)).href : spec;
}

/**
 * Load `plugins.extra`: module specifiers (absolute, relative to the working
 * directory, or bare package names) whose default export — or `plugin` export —
 * is a plugin. A module that does not export one fails loudly with its
 * specifier, because a silently ignored extension is worse than a broken boot.
 */
export async function loadExtraPlugins(specs: readonly string[], cwd: string): Promise<Plugin[]> {
  const out: Plugin[] = [];
  for (const spec of specs) {
    const target = resolveModuleSpec(spec, cwd);
    let module: Record<string, unknown>;
    try {
      module = (await import(target)) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`plugins.extra: cannot load "${spec}": ${errMessage(err)}`);
    }
    const candidate = module['default'] ?? module['plugin'];
    if (!isPlugin(candidate)) {
      throw new Error(
        `plugins.extra: "${spec}" does not export a plugin (default or "plugin") — expected ` +
          `{ name, apply(ctx) } or a function(ctx)`,
      );
    }
    out.push(withName(module, candidate, spec));
  }
  return out;
}

/**
 * Give a plugin a name it can be rostered, switched and reported under.
 *
 * A function plugin and an object plugin both may omit `name` (core resolves one
 * lazily from the function's own name or a caller fallback), but the roster
 * needs a stable identity EAGERLY: `plugins.disable` matches on it, and the
 * manifest row is built from it. The module specifier is the honest fallback —
 * it is what the operator typed in their config, so a row that cannot be named
 * is at least traceable to the line that loaded it.
 *
 * The declared name is resolved with core's OWN rule (`pluginName`), never a
 * second copy: the name a plugin is switched off under and the name it is
 * reported under have to be the same string.
 */
function withName(module: Record<string, unknown>, plugin: AnyPlugin, spec: string): Plugin {
  const fromModule = typeof module['name'] === 'string' && module['name'].length > 0 ? module['name'] : spec;
  const declared = pluginName(plugin, fromModule);
  if (typeof plugin === 'function') return Object.assign(plugin, { name: declared });
  return { ...(plugin as object), name: declared } as Plugin;
}

/**
 * The one shape a `plugins.extra` module must export: core's plugin protocol.
 * An object needs `apply`; a function IS the apply. A legacy `{ name, activate }`
 * object is rejected loudly rather than silently loaded — that vocabulary is
 * gone, and a module still written against it would otherwise register nothing
 * while looking like it loaded.
 */
function isPlugin(value: unknown): value is Plugin {
  if (typeof value === 'function') return true;
  if (typeof value !== 'object' || value === null) return false;
  const shape = value as { apply?: unknown; activate?: unknown };
  if (typeof shape.activate === 'function' && typeof shape.apply !== 'function') {
    throw new Error(
      'plugins.extra: this module uses the removed { name, activate(ctx) } plugin API — '
        + 'rewrite it as { name, inject?, apply(ctx) } and register through ctx (see AGENTS.md §5)',
    );
  }
  return typeof shape.apply === 'function';
}
