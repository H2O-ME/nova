import { describe, expect, it } from 'vitest';
import { flattenBlocks } from '../src/tui/frame.js';

// Grok 留白契约（scrollback/state/layout.rs:1555-1563 + entry_renderer.rs:405-412）：
// 条目之间恒 1 空行，用户提问自带 vpad（净 2 行），只有连续折叠的工具行彼此不留。
describe('flattenBlocks spacing contract', () => {
  it('条目之间恒留一行：提问/思考/答案不再挤成一块实心砖', () => {
    const { flat } = flattenBlocks(
      [
        { lines: ['q'], wrapped: undefined, kind: 'user' },
        { lines: ['thinking'], wrapped: undefined, kind: 'reasoning' },
        { lines: ['answer'], wrapped: undefined, kind: 'assistant' },
      ],
      80,
    );
    expect(flat).toEqual(['', 'q', '', 'thinking', '', 'answer']);
  });

  it('答案与工具行也各起一行呼吸（批7 的整轮紧排抄反了）', () => {
    const { flat } = flattenBlocks(
      [
        { lines: ['q'], wrapped: undefined, kind: 'user' },
        { lines: ['answer'], wrapped: undefined, kind: 'assistant' },
        { lines: ['✓ 执行命令'], wrapped: undefined, kind: 'tool' },
      ],
      80,
    );
    expect(flat).toEqual(['', 'q', '', 'answer', '', '✓ 执行命令']);
  });

  it('跨轮：上一轮的答案与下一轮提问之间净 2 行（gap 1 + prompt vpad 1）', () => {
    const { flat } = flattenBlocks(
      [
        { lines: ['a1'], wrapped: undefined, kind: 'assistant' },
        { lines: ['q2'], wrapped: undefined, kind: 'user' },
      ],
      80,
    );
    expect(flat).toEqual(['a1', '', '', 'q2']);
  });

  it('no leading or trailing blank rows', () => {
    const { flat } = flattenBlocks([{ lines: ['only'], wrapped: undefined }], 80);
    expect(flat).toEqual(['only']);
  });

  it('empty blocks contribute no extra blanks (no double gaps)', () => {
    const { flat } = flattenBlocks(
      [
        { lines: ['q'], wrapped: undefined },
        { lines: [''], wrapped: undefined },
        { lines: ['a'], wrapped: undefined },
      ],
      80,
    );
    expect(flat).toEqual(['q', '', 'a']);
  });

  it('rowMap still covers every flat row for click hit-testing', () => {
    const { flat, rowMap } = flattenBlocks(
      [
        { lines: ['q'], wrapped: undefined, kind: 'user' },
        { lines: ['thinking'], wrapped: undefined, kind: 'reasoning' },
        { lines: ['a'], wrapped: undefined, kind: 'assistant' },
      ],
      80,
    );
    expect(rowMap).toHaveLength(3);
    const covered = rowMap.reduce((n, seg) => n + seg.count, 0);
    expect(covered).toBe(3);
    // 其余全是分隔空行——rowMap 的 count 只数内容行，点击命中靠 start 不靠连续性。
    expect(flat).toHaveLength(6);
    expect(flat.filter((row) => row === '')).toHaveLength(3);
  });
});
