/**
 * The diff renderer's parser (`rightbar/git-diff-rows.ts`).
 *
 * A unified diff is text git already spelled; the page's job is to draw it with
 * line numbers, so the two facts worth pinning are that the numbers come from the
 * hunk header (the only place git states them) and that the file's own header
 * lines do not become rows (the pane's head already names the file).
 */
import { describe, expect, it } from 'vitest';
import { diffStatRows, FOLD_THRESHOLD, folds, MAX_RENDERED_LINES, parseUnifiedDiff, splitRows } from '../src/rightbar/git-diff-rows.js';

const SAMPLE = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' const d = 5;',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('unified diff parsing', () => {
  it('numbers lines from the hunk header and drops the file header', () => {
    const rows = parseUnifiedDiff(SAMPLE);
    expect(rows[0]).toEqual({ kind: 'hunk', oldNo: null, newNo: null, text: '@@ -1,3 +1,4 @@' });
    expect(rows.slice(1).map((row) => [row.kind, row.oldNo, row.newNo, row.text])).toEqual([
      ['ctx', 1, 1, 'const a = 1;'],
      ['del', 2, null, 'const b = 2;'],
      ['add', null, 2, 'const b = 3;'],
      ['add', null, 3, 'const c = 4;'],
      ['ctx', 3, 4, 'const d = 5;'],
      ['meta', null, null, 'No newline at end of file'],
    ]);
  });

  it('reads a second hunk from its own header', () => {
    const rows = parseUnifiedDiff('@@ -10,1 +11,1 @@\n-old\n+new\n');
    expect(rows[1]).toEqual({ kind: 'del', oldNo: 10, newNo: null, text: 'old' });
    expect(rows[2]).toEqual({ kind: 'add', oldNo: null, newNo: 11, text: 'new' });
  });

  it('counts the added and removed lines', () => {
    expect(diffStatRows(parseUnifiedDiff(SAMPLE))).toEqual({ added: 2, removed: 1 });
  });

  it('folds only the long content rows', () => {
    const long = 'x'.repeat(FOLD_THRESHOLD + 1);
    const rows = parseUnifiedDiff(`@@ -1,1 +1,1 @@\n-${long}\n+short\n`);
    expect(folds(rows[1]!)).toBe(true);
    expect(folds(rows[2]!)).toBe(false);
    expect(folds(rows[0]!)).toBe(false);
  });

  it('stops a pathological diff with a marker instead of laying out every row', () => {
    const body = Array.from({ length: MAX_RENDERED_LINES + 50 }, () => '+x').join('\n');
    const rows = parseUnifiedDiff(`@@ -1,0 +1,${String(MAX_RENDERED_LINES + 50)} @@\n${body}\n`);
    expect(rows).toHaveLength(MAX_RENDERED_LINES + 1);
    expect(rows.at(-1)?.kind).toBe('more');
  });

  it('renders nothing for an empty diff (an untracked file has none)', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

/**
 * The side-by-side projection. Pairing is the whole point of the view: a run of
 * deletions is aligned with the additions that REPLACE it, so a run longer than
 * its partner leaves filler rather than sliding the rest of the file up.
 */
describe('side-by-side pairing', () => {
  it('pairs each deletion run with the additions that follow it', () => {
    const rows = parseUnifiedDiff([
      '@@ -1,4 +1,4 @@',
      ' keep',
      '-old a',
      '-old b',
      '+new a',
      '+new b',
      ' tail',
    ].join('\n') + '\n');
    const lines = splitRows(rows);
    expect(lines.map((line) => line.kind)).toEqual(['full', 'pair', 'pair', 'pair', 'pair']);
    // The context line above the run is its own pair; the run itself follows.
    expect(lines[1]).toEqual({
      kind: 'pair',
      left: { no: 1, text: 'keep', kind: 'ctx', at: 1 },
      right: { no: 1, text: 'keep', kind: 'ctx', at: 1 },
    });
    expect(lines[2]).toEqual({
      kind: 'pair',
      left: { no: 2, text: 'old a', kind: 'del', at: 2 },
      right: { no: 2, text: 'new a', kind: 'add', at: 4 },
    });
    // Context sits on both sides and carries ONE source index (the highlight
    // of a context line is the same line of text either way).
    expect(lines[0]).toMatchObject({ kind: 'full', row: { kind: 'hunk' } });
    expect(lines[4]).toEqual({
      kind: 'pair',
      left: { no: 4, text: 'tail', kind: 'ctx', at: 6 },
      right: { no: 4, text: 'tail', kind: 'ctx', at: 6 },
    });
  });

  it('fills the short side instead of shifting the rest of the file', () => {
    const rows = parseUnifiedDiff('@@ -1,2 +1,1 @@\n-a\n-b\n+c\n');
    const lines = splitRows(rows);
    expect(lines[1]).toMatchObject({ kind: 'pair', left: { text: 'a' }, right: { text: 'c' } });
    expect(lines[2]).toEqual({ kind: 'pair', left: { no: 2, text: 'b', kind: 'del', at: 2 }, right: null });
  });

  it('keeps the add run paired when deletions come second', () => {
    // `+` lines before any `-` line: the run flush happens on the context row
    // in between, not on the sign.
    const rows = parseUnifiedDiff('@@ -1,3 +1,3 @@\n+a\n ctx\n-b\n+c\n');
    expect(splitRows(rows).slice(1)).toEqual([
      { kind: 'pair', left: null, right: { no: 1, text: 'a', kind: 'add', at: 1 } },
      {
        kind: 'pair',
        left: { no: 1, text: 'ctx', kind: 'ctx', at: 2 },
        right: { no: 2, text: 'ctx', kind: 'ctx', at: 2 },
      },
      { kind: 'pair', left: { no: 2, text: 'b', kind: 'del', at: 3 }, right: { no: 3, text: 'c', kind: 'add', at: 4 } },
    ]);
  });

  it('draws git notes and the truncation marker across both columns', () => {
    const rows = parseUnifiedDiff('@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n');
    expect(splitRows(rows).map((line) => line.kind)).toEqual(['full', 'pair', 'full', 'pair']);
  });
});
