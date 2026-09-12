import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { palette, plainPalette } from '../src/index.js';
import {
  extractReasoningHeader,
  reasoningDetailRows,
  reasoningLiveRow,
  reasoningRows,
  REASONING_LIVE_MAX_ROWS,
  REASONING_MAX_LINES,
  summaryRow,
} from '../src/index.js';

describe('reasoningLiveRow (auto-expanded while streaming)', () => {
  it('empty buffer renders a bare shimmer placeholder', () => {
    expect(reasoningLiveRow(plainPalette, { partial: '', cols: 80 })).toEqual(['⋯']);
  });

  it('shows newest settled lines plus one live tail row', () => {
    expect(reasoningLiveRow(plainPalette, { done: ['a', 'b'], partial: 'par', cols: 80 })).toEqual([
      '│ a',
      '│ b',
      '│ ⋯ par',
    ]);
  });

  it('caps the live window so long thoughts cannot flood the view', () => {
    const done = Array.from({ length: 50 }, (_, i) => `line-${i}`);
    const rows = reasoningLiveRow(plainPalette, { done, partial: 'tail', cols: 80 });
    expect(rows).toHaveLength(REASONING_LIVE_MAX_ROWS);
    expect(rows.at(-1)).toBe('│ ⋯ tail');
  });

  it('rows fit narrow cols by display columns', () => {
    const rows = reasoningLiveRow(plainPalette, { done: ['x'.repeat(500)], partial: 'y'.repeat(500), cols: 40 });
    const budget = 40 - 1 - 4;
    for (const line of rows) expect(styledWidth(line)).toBeLessThanOrEqual(budget);
  });
});

describe('extractReasoningHeader (Codex first-**bold** rule)', () => {
  it('returns undefined until the closing pair streams in', () => {
    expect(extractReasoningHeader('plain text')).toBeUndefined();
    expect(extractReasoningHeader('**unclosed')).toBeUndefined();
  });

  it('extracts the first bold span trimmed', () => {
    expect(extractReasoningHeader('**正在检索** 其余')).toBe('正在检索');
  });
});

describe('reasoningRows (legacy window, kept for compat)', () => {
  it('window = committed lines + exactly one live tail row', () => {
    const rows = (done: string[], partial: string, cols = 80): string[] =>
      reasoningRows(plainPalette, { done, partial, cols });
    expect(rows([], 'hmm')).toEqual(['⋯ hmm']);
    expect(rows(['a', 'b'], 'par')).toEqual(['a', 'b', '⋯ par']);
  });

  it('every row fits its single display line at narrow cols', () => {
    const rows = (done: string[], partial: string, cols = 80): string[] =>
      reasoningRows(plainPalette, { done, partial, cols });
    const long = 'x'.repeat(500);
    const budget = 40 - 1 - 4;
    for (const line of rows([long, long], long, 40)) {
      expect(styledWidth(line)).toBeLessThanOrEqual(budget);
    }
    expect(rows([long, long], long, 40)).toHaveLength(REASONING_MAX_LINES + 1);
  });
});

describe('summaryRow + reasoningDetailRows', () => {
  it('collapsed reads ▸, expanded reads ▾ — the toggle affordance', () => {
    expect(summaryRow(plainPalette, 12, false)).toBe('▸ 已思考 12s');
    expect(summaryRow(plainPalette, 12, true)).toBe('▾ 已思考 12s');
    expect(summaryRow(palette, 12, false)).toContain('[2m▸'); // dim
  });

  it('detail keeps original line breaks with a continuous quote lane', () => {
    expect(reasoningDetailRows(plainPalette, ['先想', '', '再写'])).toEqual(['│ 先想', '│', '│ 再写']);
    expect(reasoningDetailRows(palette, ['先想'])[0]).toContain('[2m'); // dim
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
