import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { plainPalette } from '../src/ui.js';
import { reasoningRows, REASONING_MAX_LINES } from '../src/reasoning.js';

const rows = (done: string[], partial: string, cols = 80): string[] =>
  reasoningRows(plainPalette, { done, partial, cols });

describe('reasoningRows', () => {
  it('window = committed lines + exactly one live tail row', () => {
    expect(rows([], 'hmm')).toEqual(['⋯ hmm']);
    expect(rows(['a', 'b'], 'par')).toEqual(['a', 'b', '⋯ par']);
  });

  it('committed blank lines never produce rows（空行挤占定格位 = 间距失控）', () => {
    expect(rows(['', 'x', '  ', ''], 'p')).toEqual(['x', '⋯ p']);
  });

  it('every row fits its single display line at narrow cols（绝不二次折行）', () => {
    const long = 'x'.repeat(500);
    const budget = 40 - 1 - 4;
    for (const line of rows([long, long], long, 40)) {
      expect(styledWidth(line)).toBeLessThanOrEqual(budget);
    }
    expect(rows([long, long], long, 40)).toHaveLength(REASONING_MAX_LINES + 1);
  });

  it('tail keeps the NEWEST text（流式读起来是文字在流动，不是整段重排）', () => {
    const r = rows([], 'a'.repeat(300) + 'END', 40);
    expect(r[0]?.startsWith('⋯ ')).toBe(true);
    expect(r[0]?.endsWith('END')).toBe(true);
  });

  it('CJK lines clip by display columns', () => {
    const r = rows(['你'.repeat(100)], '好'.repeat(100), 40);
    for (const line of r) expect(styledWidth(line)).toBeLessThanOrEqual(35);
  });

  it('tiny cols still render (floor 10) without throwing', () => {
    expect(rows(['x'], 'y', 4)).toEqual(['x', '⋯ y']);
  });
});
