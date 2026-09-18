import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { palette, plainPalette } from '../src/index.js';
import {
  reasoningDetailRows,
  reasoningLiveRow,
  REASONING_LIVE_MAX_ROWS,
  summaryRow,
} from '../src/index.js';

describe('reasoningLiveRow (codex-style scrolling while streaming)', () => {
  it('empty buffer renders a bare shimmer placeholder', () => {
    expect(reasoningLiveRow(plainPalette, { partial: '', cols: 80 })).toEqual(['⋯']);
    expect(reasoningLiveRow(plainPalette, { partial: '   ', cols: 80 })).toEqual(['⋯']);
  });

  it('renders plain dim text rows: settled lines then the live tail (no lane/marker prefixes)', () => {
    expect(reasoningLiveRow(plainPalette, { done: ['a', 'b'], partial: 'par', cols: 80 })).toEqual([
      'a',
      'b',
      'par',
    ]);
  });

  it('blank settled lines never take a row', () => {
    expect(reasoningLiveRow(plainPalette, { done: ['', 'x', '  '], partial: 'p', cols: 80 })).toEqual(['x', 'p']);
  });

  it('caps the live window so long thoughts cannot flood the view', () => {
    const done = Array.from({ length: 50 }, (_, i) => `line-${i}`);
    const rows = reasoningLiveRow(plainPalette, { done, partial: 'tail', cols: 80 });
    expect(rows).toHaveLength(REASONING_LIVE_MAX_ROWS);
    expect(rows[0]).toBe(`line-${50 - REASONING_LIVE_MAX_ROWS + 1}`); // 50 lines + tail = 51 rows
    expect(rows.at(-1)).toBe('tail');
  });

  it('rows fit narrow cols by display columns', () => {
    const rows = reasoningLiveRow(plainPalette, { done: ['x'.repeat(500)], partial: 'y'.repeat(500), cols: 40 });
    const budget = 40 - 1 - 4;
    for (const line of rows) expect(styledWidth(line)).toBeLessThanOrEqual(budget);
  });

  it('tail keeps the NEWEST text', () => {
    const r = reasoningLiveRow(plainPalette, { done: [], partial: 'a'.repeat(300) + 'END', cols: 40 });
    expect(r.at(-1)?.endsWith('END')).toBe(true);
  });

  it('clips instead of wrapping: one row per source line, no mid-token fragments', () => {
    // A 300-char line used to be wrapLine'd into ~9 rows — the window slid
    // over fragments and reflowed every tick. Now: one clipped row each.
    const rows = reasoningLiveRow(plainPalette, { done: ['x'.repeat(300)], partial: 'abc'.repeat(100) + 'NEWEST', cols: 40 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(`${'x'.repeat(33)}…`);
    expect(rows[1]!.endsWith('NEWEST')).toBe(true);
    for (const r of rows) expect(styledWidth(r)).toBeLessThanOrEqual(40 - 1 - 4);
  });

  it('tail stays inside the row budget with no animation glyph (no orphan continuation rows)', () => {
    const rows = reasoningLiveRow(plainPalette, { done: [], partial: 'y'.repeat(500) + 'END', cols: 40 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endsWith('END')).toBe(true);
    expect(styledWidth(rows[0]!)).toBeLessThanOrEqual(40 - 1 - 4);
  });
});

describe('summaryRow + reasoningDetailRows (fold header + click-expand)', () => {
  it('collapsed reads ▸, expanded reads ▾ — the toggle affordance', () => {
    expect(summaryRow(plainPalette, 12, false)).toBe('▸ 已思考 12s');
    expect(summaryRow(plainPalette, 12, true)).toBe('▾ 已思考 12s');
    expect(summaryRow(palette, 12, false)).toContain('[2m▸'); // dim
  });

  it('sub-10s thoughts keep one decimal; ≥10s rounds away', () => {
    expect(summaryRow(plainPalette, 4.24, false)).toBe('▸ 已思考 4.2s');
    expect(summaryRow(plainPalette, 0.8, false)).toBe('▸ 已思考 0.8s');
    expect(summaryRow(plainPalette, 9.99, false)).toBe('▸ 已思考 10.0s');
    expect(summaryRow(plainPalette, 12.6, false)).toBe('▸ 已思考 13s');
  });

  it('detail keeps original line breaks with a continuous quote lane', () => {
    expect(reasoningDetailRows(plainPalette, ['先想', '', '再写'])).toEqual(['│ 先想', '│', '│ 再写']);
    expect(reasoningDetailRows(palette, ['先想'])[0]).toContain('[2m'); // dim
  });

  it('soft-wraps overlong lines keeping the quote lane on continuation rows', () => {
    const long = 'word '.repeat(20);
    const rows = reasoningDetailRows(plainPalette, [long], 40);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      expect(r.startsWith('│ ')).toBe(true);
    }
  });
});

describe('reasoningLiveRow streaming tail (no animation)', () => {
  it('the live tail is plain text — no cycling glyph prefix', () => {
    const rows = reasoningLiveRow(plainPalette, { done: ['已想完的行'], partial: '还在想', cols: 40 });
    expect(rows[0]).toBe('已想完的行');
    expect(rows.at(-1)).toBe('还在想');
  });

  it('renders a static placeholder when nothing has streamed yet', () => {
    expect(reasoningLiveRow(plainPalette, { done: [], partial: '', cols: 40 })).toEqual(['⋯']);
  });

  it('stays static (⋯) without a frame — folded/test surfaces', () => {
    expect(reasoningLiveRow(plainPalette, { done: [], partial: '', cols: 40 })).toEqual(['⋯']);
  });
});
