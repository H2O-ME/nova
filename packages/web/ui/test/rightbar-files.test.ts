/**
 * The 文件 tab's tree model (`rightbar/files-model.ts`).
 *
 * The load-bearing rule: **one refusal must not blank a drawn tree.** The host's
 * `directory_error` frame carries no path (the picker it was written for draws a
 * single level and needs none), so this model can only mark what was in flight —
 * and the levels already on screen must survive it. A refresh that fails while
 * the workspace is being written to is the common case, not the rare one.
 */
import type { DirectoryEntry } from '@nova-agent/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_TREE_ROWS,
  needsListing,
  sortEntries,
  toggleExpanded,
  treeAsk,
  treeError,
  treeLevel,
  treeRows,
  type TreeState,
} from '../src/rightbar/files-model.js';
import type { WireDirectoryLevel } from '../src/types.js';

const entry = (name: string, path: string, kind: 'dir' | 'file' = 'file'): DirectoryEntry => ({
  name,
  path,
  hidden: false,
  kind,
});

const level = (path: string, entries: readonly DirectoryEntry[], truncated = false): WireDirectoryLevel => ({
  path,
  home: '/home/u',
  crumbs: [],
  roots: [],
  entries,
  truncated,
});

describe('file tree model', () => {
  it('orders directories before files, then names case-insensitively', () => {
    const sorted = sortEntries([entry('zeta', '/w/zeta'), entry('Beta', '/w/Beta'), entry('src', '/w/src', 'dir')]);
    expect(sorted.map((item) => item.name)).toEqual(['src', 'Beta', 'zeta']);
  });

  it('keys its levels by the HOST’s path and retires the placeholder it settles', () => {
    // The panel asks with the path it holds; the host answers with the resolved
    // one (a symlinked or case-folded spelling differs). The answer must land
    // under ITS OWN key — and the ask's placeholder must go, or `needsListing`
    // would read "a level exists" as "already read" and the directory would show
    // 正在读取… forever.
    const asked: TreeState = treeAsk({ levels: {}, asking: [] }, '/w/Link');
    const folded = treeLevel(asked, level('/w/real', [entry('a.txt', '/w/real/a.txt')]));
    expect(Object.keys(folded.levels)).toEqual(['/w/real']);
    expect(folded.asking).toEqual([]);
    expect(needsListing(folded, '/w/Link')).toBe(true);
  });

  it('draws a loading line for the level it is waiting for, not an empty directory', () => {
    const tree = treeAsk({ levels: {}, asking: [] }, '/w');
    const rows = treeRows(tree, '/w', []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'note', depth: 0 });
    // An empty directory says something different from "not read yet".
    const empty = treeRows(treeLevel(tree, level('/w', [])), '/w', []);
    expect((empty[0] as { text: string }).text).not.toBe((rows[0] as { text: string }).text);
  });

  it('splices an expanded directory’s level in beneath it', () => {
    let tree = treeLevel(treeAsk({ levels: {}, asking: [] }, '/w'), level('/w', [entry('src', '/w/src', 'dir'), entry('a.ts', '/w/a.ts')]));
    tree = treeLevel(tree, level('/w/src', [entry('b.ts', '/w/src/b.ts')]));
    const collapsed = treeRows(tree, '/w', []);
    expect(collapsed.map((row) => (row.kind === 'entry' ? row.entry.name : row.text))).toEqual(['src', 'a.ts']);
    const open = treeRows(tree, '/w', ['/w/src']);
    expect(open.map((row) => (row.kind === 'entry' ? row.entry.name : row.text))).toEqual(['src', 'b.ts', 'a.ts']);
    expect(open[1]).toMatchObject({ kind: 'entry', depth: 1 });
  });

  it('keeps a drawn level when a refusal arrives for another one', () => {
    // The killing case: a failed refresh of the root must not empty the tree the
    // reader is already using.
    let tree = treeLevel({ levels: {}, asking: [] }, level('/w', [entry('src', '/w/src', 'dir')]));
    tree = treeAsk(tree, '/w/src');
    const refused = treeError(tree, 'EACCES');
    expect(refused.levels['/w']?.status).toBe('ready');
    expect(refused.levels['/w/src']).toMatchObject({ status: 'error', error: 'EACCES' });
    expect(refused.asking).toEqual([]);
  });

  it('marks a level loading once, and never re-asks for a level it holds', () => {
    const asked = treeAsk({ levels: {}, asking: [] }, '/w');
    expect(treeAsk(asked, '/w')).toBe(asked);
    const ready = treeLevel(asked, level('/w', [entry('a.ts', '/w/a.ts')]));
    expect(treeAsk(ready, '/w')).toBe(ready);
    expect(needsListing(ready, '/w')).toBe(false);
    expect(needsListing(ready, '/w/src')).toBe(true);
  });

  it('toggles an expansion without mutating the set it was given', () => {
    const before = ['/w/src'];
    const open = toggleExpanded(before, '/w/lib');
    const closed = toggleExpanded(open, '/w/src');
    expect(before).toEqual(['/w/src']);
    expect(open).toEqual(['/w/src', '/w/lib']);
    expect(closed).toEqual(['/w/lib']);
  });

  it('bounds the rows one expansion set can produce', () => {
    const many = Array.from({ length: MAX_TREE_ROWS + 200 }, (_, index) => entry(`f${index}.ts`, `/w/f${index}.ts`));
    const rows = treeRows(treeLevel({ levels: {}, asking: [] }, level('/w', many)), '/w', []);
    expect(rows.length).toBeLessThanOrEqual(MAX_TREE_ROWS);
  });

  it('says a truncated level was truncated', () => {
    const tree = treeLevel({ levels: {}, asking: [] }, level('/w', [entry('a.ts', '/w/a.ts')], true));
    const last = treeRows(tree, '/w', []).at(-1);
    expect(last).toMatchObject({ kind: 'note' });
  });

  it('is empty, not broken, before the host has answered', () => {
    expect(treeRows({ levels: {}, asking: [] }, '/w', [])).toEqual([]);
  });
});
