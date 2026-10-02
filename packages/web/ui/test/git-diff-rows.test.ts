/**
 * The diff renderer's parser (`rightbar/git-diff-rows.ts`).
 *
 * A unified diff is text git already spelled; the page's job is to draw it with
 * line numbers, so the two facts worth pinning are that the numbers come from the
 * hunk header (the only place git states them) and that the file's own header
 * lines do not become rows (the pane's head already names the file).
 */
import { describe, expect, it } from 'vitest';
import { diffStatRows, FOLD_THRESHOLD, folds, MAX_DIFF_ROWS, parseUnifiedDiff } from '../src/rightbar/git-diff-rows.js';

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
    const body = Array.from({ length: MAX_DIFF_ROWS + 50 }, () => '+x').join('\n');
    const rows = parseUnifiedDiff(`@@ -1,0 +1,${String(MAX_DIFF_ROWS + 50)} @@\n${body}\n`);
    expect(rows).toHaveLength(MAX_DIFF_ROWS + 1);
    expect(rows.at(-1)?.kind).toBe('more');
  });

  it('renders nothing for an empty diff (an untracked file has none)', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
