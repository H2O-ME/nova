import { describe, expect, it } from 'vitest';
import { flattenBlocks } from '../src/tui/frame.js';

// Grok 留白契约：空行只出现在**新语义单元之前**（用户提问 / 认不出 kind 的块）；
// 一轮之内 user → reasoning → assistant → tool 全部紧排，插行由这里单源决定。
describe('flattenBlocks spacing contract', () => {
  it('user -> reasoning -> assistant form one cohesive group without blank lines', () => {
    const { flat } = flattenBlocks(
      [
        { lines: ['q'], wrapped: undefined, kind: 'user' },
        { lines: ['thinking'], wrapped: undefined, kind: 'reasoning' },
        { lines: ['answer'], wrapped: undefined, kind: 'assistant' },
      ],
      80,
    );
    expect(flat).toEqual(['q', 'thinking', 'answer']);
  });

  it('答案与工具行都是本轮的延续：与提问之间不留白', () => {
    const { flat } = flattenBlocks(
      [
        { lines: ['q'], wrapped: undefined, kind: 'user' },
        { lines: ['answer'], wrapped: undefined, kind: 'assistant' },
        { lines: ['✓ 执行命令'], wrapped: undefined, kind: 'tool' },
      ],
      80,
    );
    expect(flat).toEqual(['q', 'answer', '✓ 执行命令']);
  });

  it('separates consecutive turns with 1 blank row', () => {
    const { flat } = flattenBlocks(
      [
        { lines: ['a1'], wrapped: undefined, kind: 'assistant' },
        { lines: ['q2'], wrapped: undefined, kind: 'user' },
      ],
      80,
    );
    expect(flat).toEqual(['a1', '', 'q2']);
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
    expect(flat).toHaveLength(3);
  });
});
