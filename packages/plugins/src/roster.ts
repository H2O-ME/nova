/**
 * The roster — which plugins load, in what order, and how config changes that.
 *
 * The built-in roster is data: a list of first-party plugins. Configuration can
 * subtract from it (`plugins.disable`) or add third-party modules
 * (`plugins.extra`), so an operator changes what the product does without
 * touching source — that is what `~/.nova/config.json` means by "select,
 * replace or extend any capability".
 *
 * Extra modules are loaded as the *public* plugin shape (`{ name, activate }`),
 * the same one the built-ins use. Container plugins with `inject` are the
 * kernel's own seams; a third party does not need them to add a tool, a command
 * or a hook.
 */
import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import type { Plugin } from './types.js';

/** Drop plugins the operator turned off, by name. Names are the roster's own. */
export function applyRoster(plugins: readonly Plugin[], disable?: readonly string[]): Plugin[] {
  if (disable === undefined || disable.length === 0) return [...plugins];
  const off = new Set(disable);
  return plugins.filter((plugin) => !off.has(plugin.name));
}

/** Names the operator listed but no built-in provides — a typo, not a no-op. */
export function unknownDisabled(
  plugins: readonly Plugin[],
  disable?: readonly string[],
): string[] {
  if (disable === undefined) return [];
  const known = new Set(plugins.map((plugin) => plugin.name));
  return disable.filter((name) => !known.has(name));
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
    const target = isAbsolute(spec) || spec.startsWith('.') ? pathToFileURL(resolve(cwd, spec)).href : spec;
    let module: Record<string, unknown>;
    try {
      module = (await import(target)) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`plugins.extra: cannot load "${spec}": ${message(err)}`);
    }
    const candidate = module['default'] ?? module['plugin'];
    if (!isPlugin(candidate)) {
      throw new Error(`plugins.extra: "${spec}" does not export a plugin (default or "plugin")`);
    }
    out.push(module['default'] !== undefined ? candidate : mixIn(module, candidate));
  }
  return out;
}

/** A module may carry the metadata as named exports next to the plugin export. */
function mixIn(module: Record<string, unknown>, plugin: Plugin): Plugin {
  const name = typeof module['name'] === 'string' ? module['name'] : plugin.name;
  return { ...plugin, name: plugin.name || name };
}

function isPlugin(value: unknown): value is Plugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { activate?: unknown }).activate === 'function'
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}