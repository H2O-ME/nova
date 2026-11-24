/**
 * Which packs a process loads: the installed root, the configured extra
 * directories, and the operator's per-pack switches.
 *
 * Kept out of `pack-loader.ts` (which knows how to READ one pack) because this
 * file answers a different question — WHICH packs exist and which are on — and
 * that answer is shared by every surface that boots a kernel. A second copy in
 * the cli would be the "two places decide enablement" defect the plugin tree
 * already has a rule against (core's `rowEnabled`).
 *
 * ## Where packs come from
 *
 *   1. `~/.nova/plugins/<name>/` — installed packs. This is the root the
 *      installer writes to and the one a user can populate by hand.
 *   2. `plugins.dirs[]` from the config — extra roots, each scanned the same
 *      way (`<dir>/<pack>/`). An operator pointing at a checkout uses this.
 *   3. `bundledDirs[]` — packs that SHIP with the product (the repo's `packs/`,
 *      shipped as `<resources>/runtime/packs`). These are samples and bundled
 *      extras, not something the operator asked for, so they are OFF until a
 *      row says `enabled: true` — see `packEnabled` below.
 *
 * ## Enablement
 *
 * Roots 1–2 are ON unless the operator turned the pack off: `plugins.entries`
 * carries one row per pack id (`pack:<name>`, or the bare name — both accepted),
 * and `enabled: false` on that row switches it off. Reusing the existing row
 * vocabulary means a pack appears in the SAME tree the plugin panel already
 * draws, with no second settings mechanism.
 *
 * Bundled packs (root 3) invert the default, and the reason is the product's own
 * write invariant: a pack's hooks run local commands at the operator's
 * privilege and several (mimosa among them) write state beside the scan root.
 * Shipping such a pack ON would break "the workspace is never written" for
 * every user who never asked for it, so presence is not consent — only an
 * explicit `enabled: true` row installs one. That is also what "install" means
 * in ZCode (where a plugin exists only after an explicit install); Nova has no
 * install step, so the row IS the install.
 */
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PluginEntryConfig } from './plugin-tree.js';
import { loadPack, readPackManifest, type LoadedPack } from './pack-loader.js';

/** The id prefix a pack row may carry (`pack:mimosa`); the bare name also works. */
export const PACK_ID_PREFIX = 'pack:';

export interface PackDiscoveryOptions {
  /** The installed packs root (`~/.nova/plugins`). */
  readonly installedRoot: string;
  /** Extra roots from `plugins.dirs`; each contains `<pack>/` directories. */
  readonly extraDirs?: readonly string[];
  /**
   * Roots whose packs SHIP with the product. A pack found here is loaded only
   * when a `plugins.entries` row says `enabled: true` (see the header).
   */
  readonly bundledDirs?: readonly string[];
  /** The operator's `plugins.entries`, read for per-pack switches. */
  readonly entries?: readonly PluginEntryConfig[];
}

/** The row that names this pack, if any (`pack:<name>` or the bare name). */
function packRow(name: string, entries: readonly PluginEntryConfig[]): PluginEntryConfig | undefined {
  return entries.find((row) => row.id === `${PACK_ID_PREFIX}${name}` || row.id === name);
}

/**
 * Whether an INSTALLED pack is on: off only when its row says `enabled: false`.
 * Absent row = on, because putting a pack under `~/.nova/plugins` or naming its
 * directory in `plugins.dirs` already expressed the intent to use it.
 */
export function packEnabled(name: string, entries: readonly PluginEntryConfig[] = []): boolean {
  return packRow(name, entries)?.enabled !== false;
}

/**
 * Whether a BUNDLED pack is on: only when its row says `enabled: true`.
 * Shipping a pack is not a request to run it (see the header) — the row is the
 * install, so its absence leaves the pack inert.
 */
export function bundledPackEnabled(name: string, entries: readonly PluginEntryConfig[] = []): boolean {
  return packRow(name, entries)?.enabled === true;
}

/**
 * Discover and load every pack this process may load.
 *
 * A directory that fails to parse is reported through `onDiagnostic` and
 * skipped: one malformed pack must not prevent the others (or the kernel) from
 * starting. A pack switched off by the operator is not loaded at all — its
 * hooks must not run, which is the only thing its row is for.
 */
export async function discoverPacks(
  options: PackDiscoveryOptions,
  onDiagnostic?: (message: string) => void,
): Promise<LoadedPack[]> {
  // Bundled roots are collected separately: same scan, inverted default. A name
  // in a bundled root that an installed root also carries is the installed
  // copy's to load (that one is the operator's), so it is dropped from here.
  const installedDirs = new Set<string>();
  for (const root of [options.installedRoot, ...(options.extraDirs ?? [])]) {
    for (const dir of await candidatePackDirs(root)) installedDirs.add(dir);
  }
  const bundledDirs = new Set<string>();
  for (const root of options.bundledDirs ?? []) {
    for (const dir of await candidatePackDirs(root)) bundledDirs.add(dir);
  }

  const packs: LoadedPack[] = [];
  const seen = new Set<string>();
  for (const dir of [...installedDirs].sort()) {
    const manifest = await readPackManifest(dir);
    if (manifest === undefined) continue;
    if (!manifest.ok) {
      onDiagnostic?.(manifest.error);
      continue;
    }
    seen.add(manifest.value.name);
    if (!packEnabled(manifest.value.name, options.entries)) continue;
    const loaded = await loadPack(dir);
    if (!loaded.ok) {
      onDiagnostic?.(loaded.error);
      continue;
    }
    for (const note of loaded.value.diagnostics) onDiagnostic?.(`pack ${manifest.value.name}: ${note}`);
    packs.push(loaded.value);
  }

  for (const dir of [...bundledDirs].sort()) {
    const manifest = await readPackManifest(dir);
    if (manifest === undefined) continue;
    if (!manifest.ok) {
      onDiagnostic?.(manifest.error);
      continue;
    }
    if (seen.has(manifest.value.name)) continue;
    if (!bundledPackEnabled(manifest.value.name, options.entries)) continue;
    const loaded = await loadPack(dir);
    if (!loaded.ok) {
      onDiagnostic?.(loaded.error);
      continue;
    }
    for (const note of loaded.value.diagnostics) onDiagnostic?.(`pack ${manifest.value.name}: ${note}`);
    packs.push(loaded.value);
  }
  return packs;
}

/** The `<root>/<name>/` directories that look like packs. */
async function candidatePackDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => undefined);
  if (entries === undefined) return [];
  const out: string[] = [];
  for (const entry of entries) {
    const dir = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(dir);
      continue;
    }
    // A symlinked pack directory is legitimate (an operator linking a
    // checkout); `stat` follows the link while `readdir`'s Dirent does not.
    if (entry.isSymbolicLink()) {
      const info = await stat(dir).catch(() => undefined);
      if (info?.isDirectory() === true) out.push(dir);
    }
  }
  return out;
}
