/**
 * The file tree's git decorations: which letter a row carries and in which
 * tone — the reference's "VS Code 同款" git coloring, at the scale this product
 * needs.
 *
 * The status comes from the SAME `git_status` answer the 变更 page renders (the
 * reducer's `state.git`), so the tree and the changes page cannot disagree about
 * whether a file is modified. The decoration is deliberately small: one letter
 * and one of four tones, keyed by the row's workspace-relative path.
 *
 * Two normalizations matter and both are here:
 *   - git spells repo-relative paths with forward slashes; a tree row carries
 *     the host's absolute path (backslashes on Windows). `relativeTo` in
 *     `file-refs.ts` is the one relativizer.
 *   - Windows folds case, and the spelling a directory listing returns is not
 *     always the spelling git has on record. Keys are case-folded on win32 so a
 *     file that IS modified never renders as clean.
 */
import type { GitState } from '../state.js';
import { normalizePath, pathKey, relativeTo } from './file-refs.js';

/** One row's decoration. */
export interface GitMark {
  /** One letter, VS Code style: M / A / D / R / C / U (untracked) / ! (conflict). */
  letter: string;
  /** What the letter colors as. */
  tone: 'staged' | 'changed' | 'untracked' | 'conflict';
}

/**
 * The git status letter for one row of `git status --porcelain`.
 *
 * The index column wins when it says anything: a file staged AND modified again
 * reads as the staged change (that is the state the next commit will carry),
 * exactly the precedence VS Code uses.
 * @param index - the porcelain index column.
 * @param worktree - the porcelain worktree column.
 * @returns the letter and tone, or undefined for a row git lists as unmodified.
 */
export function markOf(index: string, worktree: string): GitMark | undefined {
  if (index === '?' || worktree === '?') return { letter: 'U', tone: 'untracked' };
  if (index === 'U' || worktree === 'U') return { letter: '!', tone: 'conflict' };
  const code = index !== ' ' && index !== '' ? index : worktree;
  if (code === ' ' || code === '') return undefined;
  const letter = code === 'C' ? 'C' : code === 'R' ? 'R' : code === 'A' ? 'A' : code === 'D' ? 'D' : 'M';
  return { letter, tone: index !== ' ' && index !== '' ? 'staged' : 'changed' };
}

/**
 * The decorations for a whole tree, keyed by a case-folded repo-relative path
 * (see the module header for why the key is normalized). The porcelain paths
 * are already repo-relative, and the workspace root IS the repo root, so no
 * prefix has to be stripped here — {@link markFor} does the relativizing.
 * @param git - the reducer's git slice (`null` before the first answer).
 * @returns one entry per changed file; an empty map when there is no repo.
 */
export function gitMarks(git: GitState | null): ReadonlyMap<string, GitMark> {
  const marks = new Map<string, GitMark>();
  if (git === null || !git.repo) return marks;
  for (const entry of git.entries) {
    const mark = markOf(entry.index, entry.worktree);
    if (mark === undefined) continue;
    const full = normalizePath(entry.path);
    marks.set(pathKey(full), mark);
    // A rename marks both spellings: the tree may be showing the new name or
    // (until its level is re-read) the old one.
    if (entry.from !== undefined && entry.from !== '') {
      marks.set(pathKey(normalizePath(entry.from)), mark);
    }
  }
  return marks;
}

/**
 * Whether anything under a directory is changed — the reference's `dirHasChanges`.
 *
 * A directory row carries no letter (git has no status for a folder); it is
 * colored instead, so a collapsed branch still says "there is something in
 * here" — which is the whole reason the decoration exists.
 * @param marks - the map from {@link gitMarks}.
 * @param root - the workspace root.
 * @param dir - the directory's absolute path.
 * @returns true when at least one changed file sits below it.
 */
export function dirHasChanges(marks: ReadonlyMap<string, GitMark>, root: string, dir: string): boolean {
  const rel = relativeTo(root, dir);
  if (rel.length === 0) return marks.size > 0;
  const prefix = `${pathKey(rel)}/`;
  for (const key of marks.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * The decoration for one tree row.
 * @param marks - the map from {@link gitMarks}.
 * @param root - the workspace root.
 * @param path - the row's absolute path as the host spelled it.
 * @returns the mark, or undefined when the file is clean (or outside the repo).
 */
export function markFor(
  marks: ReadonlyMap<string, GitMark>,
  root: string,
  path: string,
): GitMark | undefined {
  const rel = relativeTo(root, path);
  if (rel.length === 0) return undefined;
  return marks.get(pathKey(rel));
}
