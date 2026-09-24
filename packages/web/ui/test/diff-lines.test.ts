/**
 * The line diff lane (harness-grade real hunks): diffLines must interleave,
 * collapse context, and never lose a line. Pure, DOM-free.
 */
import { describe, expect, it } from 'vitest';
import { collapseContext, diffLines, diffStats } from '../src/diff-lines.js';
import type { DiffOp } from '../src/diff-lines.js';

const texts = (ops: DiffOp[]): string[] => ops.filter((o) => o.t !== 'ctx').map((o) => `${o.t}:${o.text}`);

describe('diffLines', () => {
  it('treats a null old text as a wholesale add', () => {
    expect(diffLines(null, 'a\nb')).toEqual([
      { t: 'add', text: 'a' },
      { t: 'add', text: 'b' },
    ]);
  });

  it('interleaves context around a middle edit', () => {
    const ops = diffLines('1\n2\n3\n4', '1\n2\nx\n3\n4');
    expect(texts(ops)).toEqual(['add:x']);
    expect(ops.map((o) => `${o.t}${o.text}`).join(' ')).toBe('ctx1 ctx2 addx ctx3 ctx4');
  });

  it('trims common prefix/suffix before aligning', () => {
    const ops = diffLines('a\nold\nz', 'a\nnew\nz');
    expect(texts(ops)).toEqual(['del:old', 'add:new']);
  });

  it('counts stats and keeps every line', () => {
    const ops = diffLines('x\ny', 'y\nz');
    const s = diffStats(ops);
    expect(s).toEqual({ added: 1, removed: 1 });
    const all = ops.map((o) => o.text);
    expect(all).toContain('x');
    expect(all).toContain('z');
  });

  it('handles empty new text as pure deletion', () => {
    expect(texts(diffLines('a\nb', ''))).toEqual(['del:a', 'del:b']);
  });
});

describe('collapseContext', () => {
  it('folds a long context run into head + skip + tail', () => {
    const ops: DiffOp[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ t: 'ctx' as const, text: `l${i}` })),
      { t: 'add', text: 'x' },
    ];
    const rows = collapseContext(ops, 3, 7);
    expect(rows.slice(0, 3).every((r) => r.t === 'ctx')).toBe(true);
    expect(rows[3]).toEqual({ t: 'skip', n: 4 });
    expect(rows.slice(4, 7).every((r) => r.t === 'ctx')).toBe(true);
    expect(rows[7]).toEqual({ t: 'add', text: 'x' });
  });

  it('leaves short context runs alone', () => {
    const ops: DiffOp[] = [
      { t: 'ctx', text: 'a' },
      { t: 'ctx', text: 'b' },
      { t: 'del', text: 'c' },
    ];
    expect(collapseContext(ops)).toEqual(ops);
  });
});
