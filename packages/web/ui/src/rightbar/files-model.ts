/**
 * The 文件 tab's tree model: the workspace as the host enumerates it, one level
 * at a time.
 *
 * **Why levels and not a tree.** The browser cannot read a directory itself, and
 * the host's `list_directory` answers exactly one level (absolute paths spelled
 * by the host, `dir`-only unless asked for files). So the model is a flat map
 * keyed by absolute path plus the reader's expansion set, and the rows the panel
 * draws are a fold over the two. Nothing here joins a path: a child's path is
 * whatever the host put in its entry, and this model never inspects a separator.
 *
 * **What it is not.** This is the workspace's CURRENT contents. It is not the
 * changed-file list (that is the 变更 tab, which reads the session) and it is not
 * a session browser: the session logs are the host's own listing, folded into
 * rows by `sessionFileRows` (`session-files.ts`), which is a different question
 * about a different set of files.
 */
import type { DirectoryEntry } from '@nova-agent/core';
import type { WireDirectoryLevel } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';

/** What the panel knows about one directory level. */
export interface TreeLevel {
  /** `loading` until the answer (or the refusal) lands. */
  status: 'loading' | 'ready' | 'error';
  /** The level's entries, sorted for drawing (`sortEntries`). */
  entries: readonly DirectoryEntry[];
  /** The host stopped at its entry cap: more exist than are listed. */
  truncated: boolean;
  /** Why the level could not be read (refusal only; an empty level has none). */
  error?: string;
}

/** The tree's whole state: one level per absolute path, plus what is in flight. */
export interface TreeState {
  levels: Readonly<Record<string, TreeLevel>>;
  /** Paths asked for and not yet answered (the rows draw their loading line). */
  asking: readonly string[];
}

export const emptyTree: TreeState = { levels: {}, asking: [] };

/** The rows the panel draws, in display order. */
export type TreeRow =
  | {
      kind: 'entry';
      entry: DirectoryEntry;
      /** Nesting depth; the root's own entries are 0. */
      depth: number;
      expanded: boolean;
    }
  | { kind: 'note'; text: string; depth: number; tone: 'quiet' | 'error' };

/**
 * Rows a fold may produce before it stops.
 *
 * An expansion set is user-driven and a level is host-bounded, so this is a
 * guard rather than a real product limit: it caps the damage a hostile host (or
 * a very deep workspace opened by a stuck click) can do to one render.
 */
export const MAX_TREE_ROWS = 2000;

/** Mark a path as asked-for (the row shows its loading line until answered). */
export function treeAsk(tree: TreeState, path: string): TreeState {
  if (tree.asking.includes(path) || tree.levels[path]?.status === 'ready') return tree;
  return {
    levels: { ...tree.levels, [path]: { status: 'loading', entries: [], truncated: false } },
    asking: [...tree.asking, path],
  };
}

/**
 * Fold one answered level in.
 *
 * The level is keyed by the HOST's path, always: a resolved spelling can differ
 * from what the panel asked with (a symlink, a case-folded drive on Windows), and
 * the tree draws children from their parent's entries, so the answer's own path
 * is the one that belongs in the map.
 *
 * The ask it settles is then retired — and when the resolved path differs from
 * the asked one, the placeholder left under the ASKED path is dropped rather than
 * kept: `needsListing` reads "a level exists" as "already read", so a leftover
 * spinner would refuse every later attempt to open that directory and show
 * 正在读取… forever. Dropping it costs one extra request in the worst case.
 * @param tree - the state before the answer.
 * @param level - the host's level (its `path` is the key).
 * @returns the state with that level ready.
 */
export function treeLevel(tree: TreeState, level: WireDirectoryLevel): TreeState {
  const levels = {
    ...tree.levels,
    [level.path]: {
      status: 'ready' as const,
      entries: sortEntries(level.entries),
      truncated: level.truncated,
    },
  };
  const settled = tree.asking.includes(level.path) ? level.path : tree.asking[0];
  if (settled !== undefined && settled !== level.path) delete levels[settled];
  return {
    levels,
    asking: settled === undefined ? tree.asking : tree.asking.filter((path) => path !== settled),
  };
}

/**
 * Mark every in-flight ask as refused.
 *
 * The refusal frame (`directory_error`) carries no path — the picker it was
 * written for draws one level at a time and needs none — so the honest reading
 * here is "whatever this panel was waiting for did not arrive". Any level that
 * already has entries keeps them: a failed refresh must not blank a drawn tree.
 * @param tree - the state before the refusal.
 * @param message - the host's renderable reason.
 */
export function treeError(tree: TreeState, message: string): TreeState {
  const levels = { ...tree.levels };
  for (const path of tree.asking) {
    const existing = levels[path];
    if (existing !== undefined && existing.status === 'ready' && existing.entries.length > 0) continue;
    levels[path] = { status: 'error', entries: [], truncated: false, error: message };
  }
  return { levels, asking: [] };
}

/**
 * Directories first, then names, case-insensitively — the harness's own row
 * order for its file tree. Dot-led entries keep their place rather than moving
 * to the end: hiding them is a surface decision this panel does not make (the
 * listing already says which ones are hidden).
 * @param entries - the host's entries.
 * @returns a sorted copy.
 */
export function sortEntries(entries: readonly DirectoryEntry[]): readonly DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.kind !== 'file';
    const bDir = b.kind !== 'file';
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/**
 * The visible rows: the root's entries, with each expanded directory's own level
 * spliced in beneath it.
 * @param tree - the folded levels.
 * @param root - the absolute path the tree starts at (the workspace root).
 * @param expanded - absolute paths the reader has opened.
 * @returns rows in display order; a level still loading, refused, or empty
 *   contributes a note row instead of entries.
 */
export function treeRows(tree: TreeState, root: string, expanded: readonly string[]): TreeRow[] {
  const open = new Set(expanded);
  const rows: TreeRow[] = [];
  const walk = (path: string, depth: number): void => {
    if (rows.length >= MAX_TREE_ROWS) return;
    const level = tree.levels[path];
    if (level === undefined) return; // never asked for: the row that asked draws nothing
    if (level.status === 'loading') {
      rows.push({ kind: 'note', text: RIGHTBAR_COPY['files.loading'], depth, tone: 'quiet' });
      return;
    }
    if (level.status === 'error') {
      rows.push({ kind: 'note', text: level.error ?? RIGHTBAR_COPY['files.empty'], depth, tone: 'error' });
      return;
    }
    if (level.entries.length === 0) {
      rows.push({ kind: 'note', text: RIGHTBAR_COPY['files.emptyDir'], depth, tone: 'quiet' });
      return;
    }
    for (const entry of level.entries) {
      if (rows.length >= MAX_TREE_ROWS) return;
      const isDir = entry.kind !== 'file';
      const isOpen = isDir && open.has(entry.path);
      rows.push({ kind: 'entry', entry, depth, expanded: isOpen });
      if (isOpen) walk(entry.path, depth + 1);
    }
    if (level.truncated) {
      rows.push({ kind: 'note', text: RIGHTBAR_COPY['files.truncated'], depth, tone: 'quiet' });
    }
  };
  walk(root, 0);
  return rows;
}

/**
 * The rows a search shows: every row whose NAME matches, plus the directory
 * chain that leads to it.
 *
 * The filter runs over the rows already folded, which is the only honest scope
 * there is — the browser cannot read a directory, so a level nobody opened has
 * no contents to search. Keeping the ancestors is what makes a deep match
 * readable: a lone `index.ts` with no path above it says nothing about WHICH
 * index.ts was found.
 *
 * Note rows (loading / empty / refused / truncated) are dropped while a query is
 * active: they describe a level, not a match, and the reader asked for matches.
 * @param rows - the folded rows (`treeRows`).
 * @param needle - what the reader typed; blank shows everything.
 * @returns rows in display order.
 */
export function filterRows(rows: readonly TreeRow[], needle: string): TreeRow[] {
  const query = needle.trim().toLowerCase();
  if (query === '') return [...rows];
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind !== 'entry' || !row.entry.name.toLowerCase().includes(query)) return;
    keep.add(index);
    let depth = row.depth;
    for (let back = index - 1; back >= 0 && depth > 0; back -= 1) {
      const above = rows[back];
      if (above === undefined || above.kind !== 'entry') continue;
      if (above.depth < depth) { keep.add(back); depth = above.depth; }
    }
  });
  return rows.filter((_row, index) => keep.has(index));
}

/**
 * The selectable paths of a row list, in display order: the entry rows only.
 *
 * A Shift-range is defined over THIS list, so a note row (正在读取…, 空目录)
 * must not be something a range can land on.
 * @param rows - rows in display order.
 * @returns one absolute path per entry row.
 */
export function entryPaths(rows: readonly TreeRow[]): string[] {
  return rows.flatMap((row) => (row.kind === 'entry' ? [row.entry.path] : []));
}

/**
 * Toggle one directory in the expansion set.
 * @param expanded - the set before the click.
 * @param path - the directory's absolute path.
 * @returns the new set (a new array; the caller may render it directly).
 */
export function toggleExpanded(expanded: readonly string[], path: string): string[] {
  return expanded.includes(path) ? expanded.filter((item) => item !== path) : [...expanded, path];
}

/**
 * Whether a directory must be asked for before it can be drawn: first open, and
 * the level is not already there. (A collapsed-then-reopened level is already
 * held, and re-asking would make the tree blink for no new information.)
 * @param tree - the folded levels.
 * @param path - the directory about to be opened.
 */
export function needsListing(tree: TreeState, path: string): boolean {
  return tree.levels[path] === undefined;
}
