/**
 * Composer 纯计算层单测：输入行窗口的提示行/前导/续行缩进、光标块的
 * 反色渲染、光标定位（含弹窗行数单源化后的换算）、换行预算下限。
 */

import { describe, expect, it } from 'vitest';
import { palette, plainPalette, SPINNER_FRAMES, type ComposerLayout } from '../src/index.js';
import { COMPOSER_PREFIX, COMPOSER_PREFIX_WIDTH, chipBadge, composerPlaceholder, composerWrapBudget, composerZone, cursorPosition, foldChips, messageQueueRows, renderComposerRow } from '../src/index.js';

const layout = (over: Partial<ComposerLayout> = {}): ComposerLayout => ({
  rows: [{ text: 'hello', caretIdx: -1 }],
  cursorRow: 0,
  cursorCol: 0,
  totalRows: 1,
  hiddenAbove: 0,
  hiddenBelow: 0,
  ...over,
});

const view = (over: Partial<Parameters<typeof composerZone>[2]> = {}) => ({
  spinnerFrame: 0,
  streaming: false,
  genPhase: 'idle' as const,
  ...over,
});

describe('renderComposerRow', () => {
  it('passes the row through when the caret sits on no row', () => {
    expect(renderComposerRow(plainPalette, { text: 'abc', caretIdx: -1 })).toBe('abc');
  });

  it('inverts the char under the caret (and a space at line end)', () => {
    expect(renderComposerRow(palette, { text: 'abc', caretIdx: 1 })).toBe(`a\x1b[7mb\x1b[0mc`);
    expect(renderComposerRow(palette, { text: 'abc', caretIdx: 3 })).toBe(`abc\x1b[7m \x1b[0m`);
  });

  it('plain palette keeps every char (caret is presentational only)', () => {
    expect(renderComposerRow(plainPalette, { text: 'abc', caretIdx: 1 })).toBe('abc');
  });
});

describe('composerZone', () => {
  it('prefixes the first visible row with ❯ and aligns continuation rows', () => {
    const p = plainPalette;
    const zone = composerZone(p, layout({ rows: [{ text: 'one', caretIdx: -1 }, { text: 'two', caretIdx: -1 }] }), view());
    expect(zone[0]!.startsWith(COMPOSER_PREFIX)).toBe(true);
    expect(zone[0]!.endsWith('one')).toBe(true);
    expect(zone[1]).toBe(' '.repeat(COMPOSER_PREFIX_WIDTH) + 'two');
    expect(zone).toHaveLength(2);
  });

  it('emits more-above/below hint rows and shifts the prompt off when rows scroll', () => {
    const zone = composerZone(plainPalette, layout({ hiddenAbove: 2, hiddenBelow: 3 }), view());
    expect(zone[0]).toBe('  ⋯ 上方还有 2 行');
    expect(zone[1]!.startsWith(' '.repeat(COMPOSER_PREFIX_WIDTH))).toBe(true); // 有上滚提示时不再放 ❯
    expect(zone.at(-1)).toBe('  ⋯ 下方还有 3 行');
  });

  it('swaps the prompt for the spinner while streaming; tool phase paints yellow', () => {
    const frame = SPINNER_FRAMES[3]!;
    const thinking = composerZone(palette, layout(), view({ streaming: true, genPhase: 'thinking', spinnerFrame: 3 }));
    expect(thinking[0]).toBe(`  \x1b[32m${frame}\x1b[0m hello`);
    const tool = composerZone(palette, layout(), view({ streaming: true, genPhase: 'tool', spinnerFrame: 13 }));
    expect(tool[0]).toBe(`  \x1b[33m${SPINNER_FRAMES[3]}\x1b[0m hello`); // 13 % 10 = 3
  });
});

describe('composerZone 空态占位提示（Grok welcome：按键提示寄生在输入行）', () => {
  const empty = layout({ rows: [{ text: '', caretIdx: 0 }] });

  it('光标独占一格，占位文本让开一格（绝不吃掉一个汉字）', () => {
    const zone = composerZone(palette, empty, view({ placeholder: 'abc' }));
    expect(zone[0]).toBe(`${COMPOSER_PREFIX}\x1b[7m \x1b[0m\x1b[2mabc\x1b[0m`);
    expect(composerZone(plainPalette, empty, view({ placeholder: '描述任务开始' }))[0]).toContain('描述任务开始');
  });

  it('有输入、光标不在首行、或已上滚时都不出现', () => {
    expect(composerZone(plainPalette, layout({ rows: [{ text: 'x', caretIdx: 1 }] }), view({ placeholder: 'abc' }))[0]).toContain('x');
    expect(composerZone(plainPalette, layout({ rows: [{ text: 'abc', caretIdx: -1 }] }), view({ placeholder: 'zzz' }))[0]).toContain('abc');
    expect(composerZone(plainPalette, layout({ rows: [{ text: '', caretIdx: 0 }], hiddenAbove: 1 }), view({ placeholder: 'zzz' }))[1]).not.toContain('zzz');
  });

  it('占位符不占额外行：有无 placeholder 行数相同', () => {
    expect(composerZone(plainPalette, empty, view())).toHaveLength(composerZone(plainPalette, empty, view({ placeholder: 'abc' })).length);
  });

  it('选择器在架时教 ↑↓，收场后教通用键', () => {
    expect(composerPlaceholder({ modeSelect: true })).toContain('选模式');
    expect(composerPlaceholder({ modeSelect: false })).toContain('/ 命令面板');
  });
});

describe('cursorPosition', () => {
  it('history · breathe · popup(实帧行数) · 上滚提示 · 窗口内光标行', () => {
    const c = cursorPosition({ historyRows: 12, popupRows: 7, layout: layout({ cursorRow: 1, cursorCol: 4, hiddenAbove: 1 }) });
    expect(c).toEqual({ row: 12 + 1 + 7 + 1 + 1, col: COMPOSER_PREFIX_WIDTH + 4 });
  });

  it('without popup or scroll hint the caret sits right under the breathing row', () => {
    expect(cursorPosition({ historyRows: 20, popupRows: 0, layout: layout() })).toEqual({ row: 21, col: COMPOSER_PREFIX_WIDTH });
  });

  it('queue rows shift the caret down (mid-turn message lane)', () => {
    expect(cursorPosition({ historyRows: 10, popupRows: 0, queueRows: 2, layout: layout() }).row).toBe(13);
  });
});

describe('messageQueueRows', () => {
  it('empty queue renders nothing', () => {
    expect(messageQueueRows(plainPalette, [], 100)).toEqual([]);
  });

  it('renders newest-last dim lane rows, multiline collapsed to one line', () => {
    const rows = messageQueueRows(plainPalette, ['第一条', '第二\n条'], 100);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe('  ┃ 第一条');
    expect(rows[1]).toBe('  ┃ 第二 条');
  });

  it('caps at the newest 3 with an overflow hint on top', () => {
    const rows = messageQueueRows(plainPalette, ['a', 'b', 'c', 'd', 'e'], 100);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('还有 2 条');
    expect(rows[1]).toBe('  ┃ c');
    expect(rows[3]).toBe('  ┃ e');
  });
});

describe('composerWrapBudget', () => {
  it('subtracts the prefix and margins, floored at 1', () => {
    expect(composerWrapBudget(80)).toBe(80 - COMPOSER_PREFIX_WIDTH - 2);
    expect(composerWrapBudget(3)).toBe(1);
  });
});

describe('chip fold: 长粘贴纯显示折叠 (M10 组件8)', () => {
  // 缓冲区 = `head\n<3 行粘贴>\ntail`；chip 恰好罩住粘贴段。
  const pasted = 'L1\nL2\nL3';
  const input = `head\n${pasted}\ntail`;
  const chip = { start: 5, end: 5 + pasted.length };

  it('无 chip 时是恒等投影（既有 composer 语义零扰动）', () => {
    const f = foldChips(input, []);
    expect(f.text).toBe(input);
    expect(f.toDisplay(7)).toBe(7);
    expect(f.toBuffer(7)).toBe(7);
  });

  it('徽章就地替换区间：行数学只见徽章文本', () => {
    const f = foldChips(input, [chip]);
    expect(f.text).toBe('head\n⧉ 粘贴 3行 8字\ntail');
    expect(f.text).not.toContain('L2'); // 粘贴段只在缓冲，不在显示
  });

  it('chip 内部/右缘的显示映射钳到徽章边界，往返一致', () => {
    const f = foldChips(input, [chip]);
    const bStart = 5;
    const bEnd = 5 + '⧉ 粘贴 3行 8字'.length;
    expect(f.toDisplay(chip.start)).toBe(bStart); // 光标停在徽章上（渲染反色首字）
    expect(f.toDisplay(chip.start, 'end')).toBe(bEnd); // 右移整越
    expect(f.toDisplay(10)).toBe(bStart); // 非法内部位置钳左缘
    expect(f.toDisplay(chip.end)).toBe(bEnd);
    expect(f.toBuffer(bStart)).toBe(chip.start);
    expect(f.toBuffer(bStart + 3)).toBe(chip.start); // ↑↓ 落进徽章 → 左缘
    expect(f.toBuffer(bEnd)).toBe(chip.end);
    // 徽章之后的位置带位移往返
    const tailBuf = chip.end + 2;
    expect(f.toBuffer(f.toDisplay(tailBuf))).toBe(tailBuf);
  });

  it('多 chip 排序折叠；畸形（重叠/倒挂/越界）防御性跳过', () => {
    const two = `ab\n${pasted}\ncd\n${pasted}`;
    const p1 = { start: 3, end: 3 + pasted.length };
    const s2 = two.indexOf(pasted, p1.end + 1);
    const p2 = { start: s2, end: s2 + pasted.length };
    const f = foldChips(two, [p2, p1]); // 乱序入参
    expect((f.text.match(/⧉ 粘贴/g) ?? []).length).toBe(2);
    expect(f.toBuffer(f.toDisplay(p2.end))).toBe(p2.end);
    const bad = foldChips('short', [{ start: 4, end: 2 }, { start: 0, end: 99 }]);
    expect(bad.text).toBe('short'); // 倒挂与越界都不进折叠
  });

  it('chipBadge：行数按换行计，字数 >999 折 k', () => {
    expect(chipBadge('a\nb', { start: 0, end: 3 })).toBe('⧉ 粘贴 2行 3字');
    const big = 'x'.repeat(1500);
    expect(chipBadge(big, { start: 0, end: big.length })).toContain('1.5k字');
  });
});
