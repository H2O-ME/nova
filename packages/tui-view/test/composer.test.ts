/**
 * Composer 纯计算层单测：输入行窗口的提示行/前导/续行缩进、光标块的
 * 反色渲染、光标定位（含弹窗行数单源化后的换算）、换行预算下限。
 */

import { describe, expect, it } from 'vitest';
import { palette, plainPalette, SPINNER_FRAMES, type ComposerLayout } from '../src/index.js';
import { COMPOSER_PREFIX, COMPOSER_PREFIX_WIDTH, composerWrapBudget, composerZone, cursorPosition, messageQueueRows, renderComposerRow } from '../src/index.js';

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
