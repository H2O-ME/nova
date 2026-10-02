/**
 * The 变更 page's hierarchy (`rightbar/change-tree.ts`).
 *
 * The rules worth pinning are the ones that make a change list readable: a
 * directory chain with a single child compresses to one row (so a refactor reads
 * as `src/client/changes` rather than three nested rows), a row that DOES branch
 * or holds a file stays (a row always stands for a place where something
 * changed), directories sort before files, and the collation is pinned so the
 * order cannot move with the runtime's locale.
 */
import { describe, expect, it } from 'vitest';
import { buildChangeTree, compareNames, dirPaths, type ChangeDir, type ChangeFile } from '../src/rightbar/change-tree.js';
import type { GitStatusEntry } from '../src/types.js';

/** A modified-in-worktree entry. */
function entry(path: string, over: Partial<GitStatusEntry> = {}): GitStatusEntry {
  return { path, index: ' ', worktree: 'M', ...over };
}

/** The file rows of a node list, as `path` strings (recursively). */
function files(nodes: readonly { kind: 'dir' | 'file' }[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'file') return [(node as ChangeFile).path];
    return files((node as ChangeDir).children);
  });
}

describe('the change tree', () => {
  it('compresses a single-child directory chain into one row', () => {
    const tree = buildChangeTree([entry('src/client/changes/GitLens.tsx')]);
    expect(tree).toHaveLength(1);
    const dir = tree[0] as ChangeDir;
    expect(dir.kind).toBe('dir');
    expect(dir.name).toBe('src/client/changes');
    expect(dir.path).toBe('src/client/changes');
    expect(dir.changes).toBe(1);
    expect(files(dir.children)).toEqual(['src/client/changes/GitLens.tsx']);
  });

  it('stops compressing where the path branches or a file sits', () => {
    const tree = buildChangeTree([entry('src/a.ts'), entry('src/client/b.ts')]);
    const dir = tree[0] as ChangeDir;
    expect(dir.name).toBe('src');
    // `src` holds a file of its own, so it keeps its row and its two children.
    expect(dir.children.map((child) => child.name)).toEqual(['client', 'a.ts']);
  });

  it('puts directories before files and sorts names case-insensitively', () => {
    const tree = buildChangeTree([entry('b.ts'), entry('A.ts'), entry('z/c.ts'), entry('Z/d.ts')]);
    expect(tree.map((node) => node.name)).toEqual(['Z', 'z', 'A.ts', 'b.ts']);
    // The collation is pinned: case-insensitive, code-point tiebreak after.
    expect(compareNames('a', 'B')).toBeLessThan(0);
    expect(compareNames('Z', 'z')).toBeLessThan(0);
  });

  it('counts every changed file under a directory, and skips unmodified rows', () => {
    const tree = buildChangeTree([
      entry('src/a.ts'),
      entry('src/deep/b.ts'),
      { path: 'clean.ts', index: ' ', worktree: ' ' },
      entry('src/a.ts'),
    ]);
    expect(tree).toHaveLength(1);
    expect((tree[0] as ChangeDir).changes).toBe(2);
  });

  it('keeps git’s own spelling on a file row and splits only the directories', () => {
    const tree = buildChangeTree([entry('src\\win\\a.ts')]);
    const dir = tree[0] as ChangeDir;
    expect(dir.name).toBe('src/win');
    expect(files(dir.children)).toEqual(['src\\win\\a.ts']);
  });

  it('lists every directory path, parents before children', () => {
    const tree = buildChangeTree([entry('src/a.ts'), entry('src/deep/b.ts')]);
    expect(dirPaths(tree)).toEqual(['src', 'src/deep']);
  });

  it('is empty for an empty group', () => {
    expect(buildChangeTree([])).toEqual([]);
  });
});
