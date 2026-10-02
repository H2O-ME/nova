/**
 * The tree's new pure parts, asserted without a DOM: the pick rules, the filter
 * fold, the git decorations, and the menu's placement.
 *
 * These are the pieces that decide what a reader SEES after a gesture, and the
 * ones a future change is most likely to break silently — a range that includes
 * the wrong rows, a filter that hides the path to its own match, a directory
 * that stops saying "something in here changed".
 */
import { describe, expect, it } from 'vitest';
import { clickSelection, emptySelection, isPicked, pruneSelection, selectionText } from '../src/rightbar/tree-selection.js';
import { entryPaths, filterRows, type TreeRow } from '../src/rightbar/files-model.js';
import { dirHasChanges, gitMarks, markFor, markOf } from '../src/rightbar/git-marks.js';
import type { GitState } from '../src/state.js';

const rows: TreeRow[] = [
  { kind: 'entry', entry: { name: 'src', path: '/w/src', hidden: false, kind: 'dir' }, depth: 0, expanded: true },
  { kind: 'entry', entry: { name: 'app.ts', path: '/w/src/app.ts', hidden: false, kind: 'file' }, depth: 1, expanded: false },
  { kind: 'entry', entry: { name: 'index.ts', path: '/w/src/index.ts', hidden: false, kind: 'file' }, depth: 1, expanded: false },
  { kind: 'entry', entry: { name: 'docs', path: '/w/docs', hidden: false, kind: 'dir' }, depth: 0, expanded: false },
];
const paths = entryPaths(rows);

describe('tree selection', () => {
  it('a plain click acts and clears the pick, but moves the anchor', () => {
    const picked = { paths: ['/w/src/app.ts'], anchor: '/w/src/app.ts' };
    const next = clickSelection(picked, paths, '/w/src/index.ts', { ctrl: false, shift: false });
    expect(next.paths).toEqual([]);
    expect(next.anchor).toBe('/w/src/index.ts');
  });

  it('Ctrl toggles one row and re-anchors', () => {
    const first = clickSelection(emptySelection, paths, '/w/src', { ctrl: true, shift: false });
    const second = clickSelection(first, paths, '/w/docs', { ctrl: true, shift: false });
    expect(second.paths).toEqual(['/w/src', '/w/docs']);
    expect(second.anchor).toBe('/w/docs');
    const third = clickSelection(second, paths, '/w/src', { ctrl: true, shift: false });
    expect(third.paths).toEqual(['/w/docs']);
  });

  it('Shift ranges over the VISIBLE rows, anchor included, in either direction', () => {
    const anchor = clickSelection(emptySelection, paths, '/w/src', { ctrl: true, shift: false });
    const down = clickSelection(anchor, paths, '/w/docs', { ctrl: false, shift: true });
    expect(down.paths).toEqual(['/w/src', '/w/src/app.ts', '/w/src/index.ts', '/w/docs']);
    expect(down.anchor).toBe('/w/src');
    const up = clickSelection(anchor, paths, '/w/src/app.ts', { ctrl: false, shift: true });
    expect(up.paths).toEqual(['/w/src', '/w/src/app.ts']);
  });

  it('a Shift-click with no anchor on screen starts a new pick', () => {
    // The anchor's directory was collapsed (or the file deleted): a range over
    // rows the reader cannot see would be a selection they never made.
    const stale = { paths: [], anchor: '/w/gone.ts' };
    const next = clickSelection(stale, paths, '/w/docs', { ctrl: false, shift: true });
    expect(next.paths).toEqual(['/w/docs']);
    expect(next.anchor).toBe('/w/docs');
  });

  it('drops picks that are no longer on screen, and keeps the object when nothing changed', () => {
    const picked = { paths: ['/w/src', '/w/gone.ts'], anchor: '/w/src' };
    const pruned = pruneSelection(picked, paths);
    expect(pruned.paths).toEqual(['/w/src']);
    expect(isPicked(pruned, '/w/src')).toBe(true);
    expect(pruneSelection(picked, [...paths, '/w/gone.ts'])).toBe(picked);
  });

  it('writes one absolute path per line', () => {
    expect(selectionText({ paths: ['/w/a.ts', '/w/b.ts'], anchor: null })).toBe('/w/a.ts\n/w/b.ts');
  });
});

describe('tree filter', () => {
  it('keeps the chain that leads to a match', () => {
    const shown = filterRows(rows, 'index');
    expect(shown.map((row) => (row.kind === 'entry' ? row.entry.path : ''))).toEqual(['/w/src', '/w/src/index.ts']);
  });

  it('matches case-insensitively and drops note rows while filtering', () => {
    const withNote: TreeRow[] = [...rows, { kind: 'note', text: '正在读取…', depth: 1, tone: 'quiet' }];
    expect(filterRows(withNote, 'APP')).toHaveLength(2);
  });

  it('a blank query shows everything, and no match shows nothing', () => {
    expect(filterRows(rows, '  ')).toHaveLength(rows.length);
    expect(filterRows(rows, 'nothing-here')).toEqual([]);
  });
});

describe('git decorations', () => {
  it('reads the porcelain columns with the index side winning', () => {
    expect(markOf('M', ' ')).toEqual({ letter: 'M', tone: 'staged' });
    expect(markOf(' ', 'M')).toEqual({ letter: 'M', tone: 'changed' });
    expect(markOf('?', '?')).toEqual({ letter: 'U', tone: 'untracked' });
    expect(markOf('U', 'U')).toEqual({ letter: '!', tone: 'conflict' });
    expect(markOf(' ', ' ')).toBeUndefined();
  });

  const git: GitState = {
    root: 'C:\\w',
    repo: true,
    branch: 'main',
    diff: null,
    log: [],
    entries: [
      { path: 'src/app.ts', index: ' ', worktree: 'M' },
      { path: 'src/deep/thing.ts', index: 'A', worktree: ' ' },
    ],
  };

  it('decorates files by repo-relative path and colors their directory', () => {
    const marks = gitMarks(git);
    // `relativeTo` folds case on win32 and takes either separator; the map is
    // keyed the same way, so a tree row finds its own entry.
    expect(markFor(marks, 'C:\\w', 'C:\\w\\src\\app.ts')?.letter).toBe('M');
    expect(dirHasChanges(marks, 'C:\\w', 'C:\\w\\src')).toBe(true);
    expect(dirHasChanges(marks, 'C:\\w', 'C:\\w\\src\\deep')).toBe(true);
    expect(dirHasChanges(marks, 'C:\\w', 'C:\\w\\docs')).toBe(false);
  });

  it('is silent outside a repo', () => {
    const marks = gitMarks({ root: '/w', repo: false, branch: '', diff: null, log: [], entries: [] });
    expect(marks.size).toBe(0);
    expect(dirHasChanges(marks, '/w', '/w')).toBe(false);
  });
});
