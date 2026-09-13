import { describe, expect, it } from 'vitest';
import { bottomStack } from '../src/index.js';
import { plainPalette } from '../src/index.js';

describe('bottomStack breath row', () => {
  const history = ['h1', 'h2'];
  const popups = ['p1'];
  const queue = ['q1'];
  const composer = ['❯ input'];
  const status = 'status';

  it('breathing row stays blank by default (byte-invariant layout)', () => {
    const rows = bottomStack(history, popups, queue, composer, status);
    expect(rows).toEqual([...history, '', ...popups, ...queue, ...composer, status]);
  });

  it('scroll position hint reuses the breathing row without occupying content rows', () => {
    const hint = plainPalette.dim('  ⋯ 上方还有 12 行 · Home 跳顶 / End 回到底部');
    const rows = bottomStack(history, popups, queue, composer, status, hint);
    expect(rows).toHaveLength(history.length + 1 + popups.length + queue.length + composer.length + 1);
    expect(rows[history.length]).toBe(hint);
  });
});
