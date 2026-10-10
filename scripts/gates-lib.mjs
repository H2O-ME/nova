// Shared primitives for the four gate scripts (dep-direction, structure-budget,
// test-boundary, ui-token-guard).
//
// These lived as near-identical copies in each script and had already drifted:
// `stripComments` existed as a comment-state-machine (dep-direction) AND as a
// regex pair (test-boundary) — the regex version strips markers inside string
// literals, so the same source text could pass one gate and trip the other.
// One implementation each, imported by every consumer, is the whole point:
// gates that disagree about "what is a comment" are two opinions, not a guard.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Is `path` a directory (missing file => no)? */
export function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Recursively collect every `.ts` / `.tsx` file under `dir`. */
export function collectSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (isDir(full)) out.push(...collectSources(full));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Every `packages/<pkg>/<leaf>` directory, plus the NESTED workspace members'
 * `packages/<pkg>/<sub>/<leaf>` (e.g. `packages/web/ui/src` — the largest block
 * of code in the repo, invisible to a single-level glob).
 * @param packagesDir - the repo's `packages/` directory.
 * @param leaf - the subdirectory name to collect (`'src'`, `'test'`).
 * @returns absolute existing directories, sorted for deterministic output.
 */
export function workspaceLeafDirs(packagesDir, leaf) {
  const out = [];
  for (const pkg of readdirSync(packagesDir)) {
    const top = join(packagesDir, pkg, leaf);
    if (isDir(top)) out.push(top);
    let subs;
    try {
      subs = readdirSync(join(packagesDir, pkg));
    } catch {
      continue;
    }
    for (const sub of subs) {
      const nested = join(packagesDir, pkg, sub, leaf);
      if (isDir(nested)) out.push(nested);
    }
  }
  return out.sort();
}

/**
 * Same two-pass scan as {@link workspaceLeafDirs}, but grouped by owning
 * package — dep-direction judges each file against ITS package's allowlist,
 * so it needs the package attribution, not a flat list.
 * @returns `[{ pkg, dirs }]` for every package that has at least one `<leaf>` dir.
 */
export function packageLeafDirs(packagesDir, leaf) {
  const out = [];
  for (const pkg of readdirSync(packagesDir)) {
    const dirs = [join(packagesDir, pkg, leaf)].filter(isDir);
    let subs;
    try {
      subs = readdirSync(join(packagesDir, pkg));
    } catch {
      subs = [];
    }
    for (const sub of subs) {
      const nested = join(packagesDir, pkg, sub, leaf);
      if (isDir(nested)) dirs.push(nested);
    }
    if (dirs.length > 0) out.push({ pkg, dirs });
  }
  return out;
}

/**
 * Remove comments, keep everything else (string literals included).
 *
 * Gates scan SOURCE TEXT, not AST, because dynamic edges matter: a plugin list
 * that names packages in a string table (`import()` at runtime) must pass the
 * gate exactly like a static import. That requirement keeps strings; it is
 * comments that never constitute a dependency — and they did bite: stripping a
 * header note that EXPLAINED a removed import once produced the only violation.
 *
 * A state machine, not a regex, because comment markers also occur inside
 * strings (`'https://…'`, `'/*'`); a regex cannot tell those apart and will
 * splice string contents together, inventing or hiding module specifiers.
 * @param text - full text of one source file.
 * @returns same-length-semantics text with comments replaced by a space.
 */
export function stripComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote !== null) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    out += ch;
  }
  return out;
}

/** Substring filters after `--update` (flags starting with `--` are not filters). */
export function filterArgs(argv) {
  return argv.filter((a) => !a.startsWith('--'));
}

/**
 * Explicit PUBLIC subpath exports (declared in the owning package.json's
 * `exports`), exempt from the two deep-path rules (dep-direction for src,
 * test-boundary for test). Those rules ban reaching into a package's
 * INTERNALS; a declared subpath entry is the opposite — a boundary the owner
 * publishes on purpose (`core/totals` exists because the kernel dist is a Node
 * bundle, and the browser side needs the one leaf that imports nothing).
 * Keeping the exemption a named list in the SHARED lib makes adding one an
 * explicit, reviewed act — and keeps both gates reading the same list.
 */
export const SUBPATH_EXPORTS = new Set(['core/totals']);
