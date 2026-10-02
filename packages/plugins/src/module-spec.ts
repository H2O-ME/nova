/**
 * Where a plugin module IS: the ONE resolution rule for `plugins.extra`, the
 * configured `surfaces` rows and the extension table.
 *
 * A config row is a module specifier, and it means one of three things:
 *
 *  - **a path** (absolute, or starting with `.`): resolved against the working
 *    directory — the operator wrote the row while standing in a workspace, and
 *    a local file is the zero-install way to try a plugin.
 *  - **a bare package name the product itself can resolve**: handed to Node
 *    untouched. That covers the bundled extensions and anything installed next
 *    to the product.
 *  - **a bare package name that only exists in the USER PLUGIN ROOT**
 *    (`~/.nova/plugins/`): resolved from there, because that is the one tree a
 *    user can install into (`nova plugin add`, or `pnpm add` in that directory)
 *    without reaching into wherever the product was installed.
 *
 * The user root is a **fallback, never a shadow**: a name the product can
 * already resolve keeps resolving where it did. A shadowing root would let a
 * stale copy the operator installed months ago silently replace a bundled
 * package the moment nova is upgraded — the bug would surface as "the upgrade
 * did nothing", far from its cause.
 *
 * Entry resolution inside the user root is Node's own (`createRequire` anchored
 * at the root's `package.json`), so `exports` / `module` / `main` are honored
 * rather than re-implemented. The plugin convention is
 * `exports: { ".": { types, default } }`; a package whose export map offers
 * only an `import` arm cannot be named by the CJS resolver, and the bare spec is
 * returned instead — the resulting boot error names the config row.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { userPluginsDir } from '@nova-agent/core';

/**
 * Can the product resolve this specifier on its own (before the user root is
 * tried)? Exported for diagnostics (`nova plugin list` tells a row that ships
 * with the product from one that will fail to load).
 */
export function resolvableFromProduct(spec: string): boolean {
  try {
    createRequire(import.meta.url).resolve(spec);
    return true;
  } catch {
    // Includes the "resolvable but the export map has no require/default arm"
    // case: the spec still goes back untouched, and Node's ESM resolver — the
    // one that will actually load it — gets to decide.
    return false;
  }
}

/**
 * Resolve a module spec the way plugins and surfaces load it.
 *
 * Shared by `loadExtraPlugins`, `loadSurfacePlugins` and the extension table, so
 * one config string means one thing everywhere.
 * @param spec - the config row's module specifier.
 * @param cwd - the base for relative paths (the process working directory).
 * @param homedir - Override for tests; defaults to the real home (the user plugin root lives under it).
 * @returns a file URL, or the bare spec for Node to resolve at import time.
 */
export function resolveModuleSpec(spec: string, cwd: string, homedir?: string): string {
  if (isAbsolute(spec) || spec.startsWith('.')) return pathToFileURL(resolve(cwd, spec)).href;
  if (resolvableFromProduct(spec)) return spec;
  const root = homedir === undefined ? userPluginsDir() : userPluginsDir(homedir);
  if (!existsSync(join(root, 'node_modules', spec, 'package.json'))) return spec;
  try {
    return pathToFileURL(createRequire(join(root, 'package.json')).resolve(spec)).href;
  } catch {
    return spec;
  }
}
