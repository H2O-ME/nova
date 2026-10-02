/**
 * The changes list's hierarchy: a flat `git status` answer folded into the
 * directory tree the 变更 page draws.
 *
 * Ported from the reference (`dsh-better-sidebar` `changes/change-tree.ts`,
 * MIT), including its single-child compression: a `git status` answer is a flat
 * list of repo-relative paths, and rendering that flat is how a refactor across
 * `src/client/changes/*` becomes a wall of near-identical rows. A directory with
 * no file of its own and exactly one subdirectory is not worth a row — the chain
 * reads as one label (`src/client/changes`), so a row always stands for a place
 * where something actually changed.
 *
 * Pure: no React, no DOM. Built once per group per fold; the renderer only
 * walks the result.
 */
import type { GitStatusEntry } from '../types.js';
import { markOf, type GitMark } from './git-marks.js';

/** One changed file (a leaf), carrying its porcelain letter and tone. */
export interface ChangeFile {
  kind: 'file';
  /** The file's own name (the last path segment). */
  name: string;
  /** The repo-relative path exactly as git reported it (the row's identity). */
  path: string;
  /** Its decoration: the letter shown and the ink it takes. */
  mark: GitMark;
}

/** One directory row: its children plus the number of changed files beneath. */
export interface ChangeDir {
  kind: 'dir';
  /** The display label: one segment, or the compressed chain (`src/client`). */
  name: string;
  /** The deepest directory this row stands for. */
  path: string;
  children: ChangeNode[];
  /** Changed files anywhere under this row (the row's count pill). */
  changes: number;
}

export type ChangeNode = ChangeDir | ChangeFile;

/** A directory being assembled (children keyed by their own segment). */
interface DirDraft {
  name: string;
  path: string;
  dirs: Map<string, DirDraft>;
  files: ChangeFile[];
}

/**
 * Directories before files, then by name — case-insensitively.
 *
 * The collation is PINNED (`'en'`, `sensitivity: 'base'`) rather than left to
 * the runtime's default locale: `localeCompare(other)` alone follows whatever
 * locale the browser happens to run under, so the same change list could order
 * differently on two machines. Base sensitivity makes case and accent variants
 * compare equal and the code-point tiebreak decides, so the order does not move
 * when the input order changes.
 * @param left - one label.
 * @param right - the other label.
 * @returns a negative / zero / positive comparison.
 */
export function compareNames(left: string, right: string): number {
  const collated = left.localeCompare(right, 'en', { sensitivity: 'base' });
  if (collated !== 0) return collated;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareNodes(left: ChangeNode, right: ChangeNode): number {
  if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
  return compareNames(left.name, right.name);
}

/** The number of changed files under a finished child list. */
function countFiles(nodes: readonly ChangeNode[]): number {
  let count = 0;
  for (const node of nodes) count += node.kind === 'dir' ? node.changes : 1;
  return count;
}

/** Materialize one draft directory, compressing its single-child chain. */
function finishDir(draft: DirDraft): ChangeDir {
  let name = draft.name;
  let current = draft;
  while (current.files.length === 0 && current.dirs.size === 1) {
    const only = [...current.dirs.values()][0];
    if (only === undefined) break;
    name = `${name}/${only.name}`;
    current = only;
  }
  const children = finishChildren(current);
  return { kind: 'dir', name, path: current.path, children, changes: countFiles(children) };
}

/** Finish a draft's children (directories first, then its own files). */
function finishChildren(draft: DirDraft): ChangeNode[] {
  const nodes: ChangeNode[] = [];
  for (const child of draft.dirs.values()) nodes.push(finishDir(child));
  nodes.push(...draft.files);
  nodes.sort(compareNodes);
  return nodes;
}

/**
 * Fold one group's changed files into a directory tree.
 *
 * Entries git lists as unmodified are skipped (there is nothing to draw), a
 * repeated path counts once, and an empty input yields an empty list.
 * @param entries - the group's `git status` entries.
 * @returns the tree's roots, ready to render in order.
 */
export function buildChangeTree(entries: readonly GitStatusEntry[]): ChangeNode[] {
  const root: DirDraft = { name: '', path: '', dirs: new Map(), files: [] };
  const seen = new Set<string>();
  for (const entry of entries) {
    const mark = markOf(entry.index, entry.worktree);
    if (mark === undefined) continue;
    const segments = entry.path.replace(/\\/gu, '/').split('/').filter((segment) => segment !== '' && segment !== '.');
    const leaf = segments[segments.length - 1];
    if (segments.length === 0 || leaf === undefined) continue;
    const normalized = segments.join('/');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    let at = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index] ?? '';
      let next = at.dirs.get(name);
      if (next === undefined) {
        next = { name, path: segments.slice(0, index + 1).join('/'), dirs: new Map(), files: [] };
        at.dirs.set(name, next);
      }
      at = next;
    }
    // The FILE keeps git's own spelling: every verb (stage, diff, menu) names
    // this path, and a re-joined one would be a second implementation of path
    // layout for a string git already spelled.
    at.files.push({ kind: 'file', name: leaf, path: entry.path, mark });
  }
  return finishChildren(root);
}

/**
 * The tree's directory paths, in render order — what a "collapse everything"
 * gesture (or an expanded-set default) needs to name.
 * @param nodes - the built tree's roots.
 * @returns every directory row's path, parents before children.
 */
export function dirPaths(nodes: readonly ChangeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly ChangeNode[]): void => {
    for (const node of list) {
      if (node.kind !== 'dir') continue;
      out.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
