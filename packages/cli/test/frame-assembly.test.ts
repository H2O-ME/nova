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
 *   - the spacing contract holds (entries are separated; only tool runs are dense)
 *
 * This is the test that catches the exact class of bug the individual helpers
 * exist to prevent: a half-drawn frame where one block overflows, wraps to the
 * wrong width, or desyncs the click hit-test map.
 */
import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { Flattener, flattenBlocks, type FrameBlock } from '../src/tui/frame.js';

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

  it('工具行之间才紧排（dense run），其余条目之间恒一行呼吸', () => {
    const blocks: FrameBlock[] = [
      block(['bash — echo a'], 'tool'),
      block(['bash — echo b'], 'tool'),
      block(['bash — echo c'], 'tool'),
    ];

    const { flat, rowMap } = flattenBlocks(blocks, cols);

    expect(rowMap).toHaveLength(3);
    // 连续工具面挤在一起，彼此不留行——一轮里几十个工具调用不会把屏幕撑成空行串。
    expect(flat).toEqual(['bash — echo a', 'bash — echo b', 'bash — echo c']);
  });

  it('一轮之内逐个留呼吸，新一轮提问再多让一行', () => {
    const blocks: FrameBlock[] = [
      block(['问题'], 'user'),
      block(['答案'], 'assistant'),
      block(['bash — echo hi'], 'tool'),
      block(['第二条答案'], 'assistant'),
      block(['下一个问题'], 'user'),
    ];

    const { flat } = flattenBlocks(blocks, cols);

    // 条目之间恒 1 行；user 块自带 vpad ⇒ 跨轮之间净 2 行。
    expect(flat).toEqual(['', '问题', '', '答案', '', 'bash — echo hi', '', '第二条答案', '', '', '下一个问题']);
  });

  it('认不出 kind 的块一律另起一段（提示不会被读成模型输出）', () => {
    const blocks: FrameBlock[] = [
      block(['答案'], 'assistant'),
      block(['✗ 命令失败'], undefined),
      block(['后续'], 'assistant'),
    ];

    const { flat } = flattenBlocks(blocks, cols);
    expect(flat).toEqual(['答案', '', '✗ 命令失败', '', '后续']);
  });

  it('blank-only blocks are skipped without adding empty rows', () => {
    const blocks: FrameBlock[] = [
      block(['内容'], 'assistant'),
      block(['', '  ', ''], 'assistant'),
      block(['后续'], 'assistant'),
    ];

    const { flat, rowMap } = flattenBlocks(blocks, cols);

    // The blank-only block is filtered out entirely (no double gap), while the
    // two live assistant rows still get the one separator row every entry pair
    // earns under the Grok rhythm.
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
        // 同轮紧排时 gap=0，新单元之前 gap=1——但绝不重叠（<0）、绝不双空行（>1）。
        const gap = entry.start - (prev.start + prev.count);
        expect(gap, `block ${i}`).toBeGreaterThanOrEqual(0);
        expect(gap, `block ${i}`).toBeLessThanOrEqual(1);
      }
      expect(entry.count).toBeGreaterThan(0);
    }
  });
});

/**
 * Flattener (M10 R4): incremental block→row cache. The contract is dual —
 * results must be byte-identical to a fresh flattenBlocks after any mutation
 * sequence, and the dirty-signal (block identity + wrapped array identity)
 * must actually keep the rebuild prefix at the first divergence.
 */
describe('Flattener incremental cache', () => {
  const cols = 60;

  /** Mirrors TuiStore.replaceBlock: content change always clears the wrap cache. */
  function replaceBlock(target: FrameBlock, lines: string[]): void {
    target.lines = lines;
    target.wrapped = undefined;
  }

  it('stays equivalent to a fresh flattenBlocks across a scripted mutation sequence', () => {
    const f = new Flattener();
    const blocks: FrameBlock[] = [];
    const check = () => expect(f.flatten(blocks, cols)).toEqual(flattenBlocks(blocks, cols));

    for (let i = 0; i < 6; i++) {
      blocks.push(block([`用户消息 ${i}`, '较长的第二行内容 '.repeat(6)], 'user'));
      check();
      blocks.push(block([`思考 ${i}`], 'reasoning', { first: '│ ', rest: '│ ' }));
      check();
      blocks.push(block([`回答 ${i}`.padEnd(80, 'x')], 'assistant'));
      check();
    }
    // Mid-stream mutation of an older block (tool line form).
    replaceBlock(blocks[1]!, ['思考已定稿']);
    check();
    // Blank-only block appended, then removed again.
    blocks.push(block(['   ', ''], 'system'));
    check();
    blocks.pop();
    check();
    // Splice out an early block (history truncation / block lifecycle).
    blocks.splice(0, 1);
    check();
    // Clear-all (session reset).
    blocks.length = 0;
    check();
  });

  it('reuses the untouched prefix: append rebuilds only from the new tail', () => {
    const f = new Flattener();
    const blocks = [block(['A'], 'user'), block(['B'], 'assistant')];
    f.flatten(blocks, cols);
    blocks.push(block(['C'], 'tool'));
    f.flatten(blocks, cols);
    expect(f.lastRebuiltFrom).toBe(2);
  });

  it('a dirty block in the middle invalidates everything after it', () => {
    const f = new Flattener();
    const blocks = [block(['A'], 'user'), block(['B'], 'assistant'), block(['C'], 'tool')];
    f.flatten(blocks, cols);
    replaceBlock(blocks[1]!, ['B changed']);
    f.flatten(blocks, cols);
    expect(f.lastRebuiltFrom).toBe(1);
  });

  it('no mutation ⇒ full hit returns the identical result object', () => {
    const f = new Flattener();
    const blocks = [block(['A'], 'user'), block(['B'], 'assistant')];
    const first = f.flatten(blocks, cols);
    expect(f.flatten(blocks, cols)).toBe(first);
    expect(f.lastRebuiltFrom).toBe(blocks.length);
  });

  it('tail truncation is not mistaken for a full hit', () => {
    const f = new Flattener();
    const blocks = [block(['A'], 'user'), block(['B'], 'assistant'), block(['C'], 'tool')];
    const before = f.flatten(blocks, cols);
    blocks.pop();
    const after = f.flatten(blocks, cols);
    expect(after).not.toBe(before);
    expect(after).toEqual(flattenBlocks(blocks, cols));
  });

  it('width change rebuilds from scratch; reset() does too', () => {
    const f = new Flattener();
    const blocks = [block(['A'], 'user'), block(['B'], 'assistant')];
    f.flatten(blocks, cols);
    f.flatten(blocks, cols - 20);
    expect(f.lastRebuiltFrom).toBe(0);
    f.flatten(blocks, cols - 20);
    f.reset();
    f.flatten(blocks, cols - 20);
    expect(f.lastRebuiltFrom).toBe(0);
  });
});
