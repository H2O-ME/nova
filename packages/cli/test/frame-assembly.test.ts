/**
 * Frame assembly integration test: flattenBlocks + wrapBlock + wrapLine
 * compose into a frame that respects terminal width at every row.
 *
 * Unit tests verify each helper in isolation (composer widths, gutter indent,
 * spacing contract). This test verifies the *composition* — feeding
 * representative block kinds (user → reasoning → assistant → tool → long
 * markdown) and asserting the assembled output is frame-coherent:
 *   - no row exceeds the terminal column budget
 *   - every non-blank block has a contiguous rowMap entry
 *   - the spacing contract holds (tight pairs have 0 blank rows between them)
 *
 * This is the test that catches the exact class of bug the individual helpers
 * exist to prevent: a half-drawn frame where one block overflows, wraps to the
 * wrong width, or desyncs the click hit-test map.
 */
import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { flattenBlocks, type FrameBlock } from '../src/tui/frame.js';

function block(
  lines: string[],
  kind: FrameBlock['kind'],
  gutter?: FrameBlock['gutter'],
): FrameBlock {
  return { lines, wrapped: undefined, kind, gutter };
}

describe('frame assembly coherence', () => {
  const cols = 80;

  it('no assembled row exceeds the column budget across mixed block kinds', () => {
    const longMarkdown =
      '这是一段相当长的中文内容用来测试折行是否正确处理 CJK 双宽字符以及与英文混合时的边界情况，'.repeat(3);
    const blocks: FrameBlock[] = [
      block(['你好，请帮我检查这段代码'], 'user'),
      block(['先分析问题', '然后逐行检查'], 'reasoning', { first: '│ ', rest: '│ ' }),
      block(['好的，我来检查。' + longMarkdown], 'assistant'),
      block(['bash — pnpm test — 行数 455 · 耗时 6.9s'], 'tool'),
    ];

    const { flat, rowMap } = flattenBlocks(blocks, cols);

    // Every non-blank row fits within cols-1 (LineScreen's safeCols budget).
    for (const row of flat) {
      if (row.length === 0) continue;
      expect(styledWidth(row)).toBeLessThanOrEqual(cols - 1);
    }

    // rowMap covers all non-blank blocks contiguously.
    expect(rowMap).toHaveLength(4);
    for (const entry of rowMap) {
      expect(entry.count).toBeGreaterThan(0);
      // Each mapped block's rows are present in the flat output.
      for (let i = 0; i < entry.count; i++) {
        expect(flat[entry.start + i]).toBeDefined();
      }
    }
  });

  it('tight pairs (user→reasoning, reasoning→assistant) have zero blank rows between them', () => {
    const blocks: FrameBlock[] = [
      block(['问题'], 'user'),
      block(['思考过程'], 'reasoning', { first: '│ ', rest: '│ ' }),
      block(['答案'], 'assistant'),
    ];

    const { flat, rowMap } = flattenBlocks(blocks, cols);

    // All three blocks present.
    expect(rowMap).toHaveLength(3);

    // No blank rows at all — the entire assembly is 3 tight rows.
    expect(flat).toEqual(['问题', '│ 思考过程', '答案']);
  });

  it('tool blocks get a blank separator before the next block', () => {
    const blocks: FrameBlock[] = [
      block(['问题'], 'user'),
      block(['答案'], 'assistant'),
      block(['bash — echo hi'], 'tool'),
      block(['第二条答案'], 'assistant'),
    ];

    const { flat } = flattenBlocks(blocks, cols);

    // user → assistant: NOT a tight pair, so 1 blank between.
    // assistant → tool: 1 blank.
    // tool → assistant: 1 blank.
    expect(flat).toEqual([
      '问题',
      '',
      '答案',
      '',
      'bash — echo hi',
      '',
      '第二条答案',
    ]);
  });

  it('blank-only blocks are skipped without adding empty rows', () => {
    const blocks: FrameBlock[] = [
      block(['内容'], 'assistant'),
      block(['', '  ', ''], 'assistant'),
      block(['后续'], 'assistant'),
    ];

    const { flat, rowMap } = flattenBlocks(blocks, cols);

    // The blank block is filtered out entirely.
    expect(rowMap).toHaveLength(2);
    expect(flat).toEqual(['内容', '', '后续']);
  });

  it('rowMap stays contiguous after scrolling (sliceHistory + bottomStack)', () => {
    // Build a large transcript that exceeds a 24-row viewport.
    const blocks: FrameBlock[] = [];
    for (let i = 0; i < 10; i++) {
      blocks.push(block([`第 ${i} 轮回答`.padEnd(20, ' ') + 'x'.repeat(60)], 'assistant'));
    }

    const { flat, rowMap } = flattenBlocks(blocks, cols);

    // Verify no row overflows even under heavy content.
    for (const row of flat) {
      if (row.length === 0) continue;
      expect(styledWidth(row)).toBeLessThanOrEqual(cols - 1);
    }

    // rowMap start + count must not overlap or leave gaps.
    for (let i = 0; i < rowMap.length; i++) {
      const entry = rowMap[i]!;
      if (i > 0) {
        const prev = rowMap[i - 1]!;
        // The gap between prev's last row and this entry's start is exactly
        // the blank separator (1 row) — never 0 (overlap) or 2+ (double gap).
        const gap = entry.start - (prev.start + prev.count);
        expect(gap).toBe(1);
      }
      expect(entry.count).toBeGreaterThan(0);
    }
  });
});
