import { describe, expect, it } from 'vitest';
import { anchorHistory, bottomStack } from '../src/index.js';
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

describe('anchorHistory — 视口富余空白的落点', () => {
  // sliceHistory 的产物：内容行 + 尾部补白。
  const viewport = (content: number, rows: number) => [
    ...Array.from({ length: content }, (_, i) => `c${i}`),
    ...Array<string>(rows - content).fill(''),
  ];

  it('贴底直播：空白整段上浮，最新一行贴着历史区底缘', () => {
    const { lines, topPad } = anchorHistory(viewport(3, 12), 3, 'tail');
    expect(lines).toHaveLength(12);
    expect(topPad).toBe(9);
    expect(lines.slice(topPad)).toEqual(['c0', 'c1', 'c2']);
    expect(lines[11]).toBe('c2');
    expect(lines.slice(0, topPad)).toEqual(Array<string>(topPad).fill(''));
  });

  it('开屏居中：富余空白对半分，落不下去的那一格沉在内容下面', () => {
    const { lines, topPad } = anchorHistory(viewport(3, 12), 3, 'center');
    expect(topPad).toBe(4); // 富余 9 → floor(9/2)，多的一格在下面
    expect(lines.slice(0, topPad)).toEqual(Array<string>(topPad).fill(''));
    expect(lines.slice(topPad, topPad + 3)).toEqual(['c0', 'c1', 'c2']);
    expect(lines.slice(topPad + 3)).toEqual(Array<string>(5).fill(''));
  });

  it('上滚后不挪，内容溢出视口时也不挪', () => {
    for (const mode of ['none', 'tail', 'center'] as const) {
      const full = viewport(12, 12);
      expect(anchorHistory(full, 12, mode)).toEqual({ lines: full, topPad: 0 });
    }
    const overflowing = ['c0', 'c1', 'c2'];
    expect(anchorHistory(overflowing, 3, 'tail')).toEqual({ lines: overflowing, topPad: 0 });
  });

  it('topPad 恒等于合成空白行数——点击行号减它就是内容坐标', () => {
    for (const content of [0, 1, 5, 8]) {
      const { lines, topPad } = anchorHistory(viewport(content, 8), content, 'tail');
      expect(lines.filter((l) => l === '')).toHaveLength(8 - content);
      expect(lines.slice(topPad, topPad + content)).toEqual(Array.from({ length: content }, (_, i) => `c${i}`));
    }
  });
});
