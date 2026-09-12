import { describe, expect, it } from 'vitest';
import { flattenBlocks } from '../src/tui/frame.js';

// Codex cell contract: margins belong to each cell — flattenBlocks inserts
// exactly one blank row between non-empty blocks; push sites stay dumb.
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

  it('user -> assistant without reasoning keeps 1 blank row for breathing space', () => {
    const { flat } = flattenBlocks(
      [
        { lines: ['q'], wrapped: undefined, kind: 'user' },
        { lines: ['answer'], wrapped: undefined, kind: 'assistant' },
      ],
      80,
    );
    expect(flat).toEqual(['q', '', 'answer']);
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
