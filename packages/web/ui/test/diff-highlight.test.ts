import { describe, expect, it } from 'vitest';
import { langOfPath, highlightDiffRows } from '../src/rightbar/diff-highlight.js';
import { parseUnifiedDiff } from '../src/rightbar/git-diff-rows.js';

/**
 * The diff pane's highlighting rules: a language per path, one scan of the
 * file's whole content zipped back onto the rows in order, structural rows
 * and unknown languages rendered plain.
 */

describe('langOfPath', () => {
  it('maps extensions to scanner ids, both separator styles', () => {
    expect(langOfPath('src/a.ts')).toBe('ts');
    expect(langOfPath('D:\\w\\pkg\\index.js')).toBe('js');
    expect(langOfPath('styles/x.module.css')).toBe('css');
  });

  it('answers undefined for unknown, extensionless and dotfile paths', () => {
    expect(langOfPath('README')).toBeUndefined();
    expect(langOfPath('.gitignore')).toBeUndefined();
    expect(langOfPath('a.weird')).toBeUndefined();
  });
});

describe('highlightDiffRows', () => {
  // Context lines carry their diff sign (a leading space) — a line without
  // one is not part of any hunk and the parser drops it.
  const DIFF = ['@@ -1,3 +1,1 @@', ' const a = 1;', ' // block', '+const b = "two";', '-const old = 3;'].join('\n');

  it('zips one highlighted line onto each content row, in order', () => {
    const rows = parseUnifiedDiff(DIFF);
    const hl = highlightDiffRows(rows, 'a.ts');
    expect(hl).toHaveLength(rows.length);
    // ctx: `const a = 1;` — keyword + plain runs
    const ctx = hl[1];
    expect(ctx).toBeDefined();
    expect(ctx!.map((span) => span.text).join('')).toBe('const a = 1;');
    expect(ctx!.some((span) => span.kind === 'keyword')).toBe(true);
    // add: the string literal reads as a string run
    const add = hl[3];
    expect(add!.some((span) => span.kind === 'string')).toBe(true);
  });

  it('leaves structural rows and unknown languages plain', () => {
    const rows = parseUnifiedDiff(DIFF);
    const hl = highlightDiffRows(rows, 'a.ts');
    expect(hl[0]).toBeUndefined(); // hunk
    const unknown = highlightDiffRows(rows, 'a.weird');
    expect(unknown.every((line) => line === undefined)).toBe(true);
  });

  it('threads block-comment state across rows (one scan, not per-row)', () => {
    // The `/*` opens on a context row; interior rows must read as comments.
    const rows = parseUnifiedDiff(['@@ -1,3 +1,3 @@', ' /* intro', ' still comment', '+ tail */'].join('\n'));
    const hl = highlightDiffRows(rows, 'c.c');
    expect(hl[1]!.every((span) => span.kind === 'comment')).toBe(true);
    expect(hl[2]!.every((span) => span.kind === 'comment')).toBe(true);
    expect(hl[3]!.some((span) => span.kind === 'comment')).toBe(true);
  });
});
