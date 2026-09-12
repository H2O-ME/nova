/**
 * Frame helpers: block wrapping with gutter-aware hanging indent, history
 * flattening, and bottom-stack assembly. The shell owns blocks and the
 * screen; this module owns the row math so it stays unit-testable.
 */

import { styledWidth, wrapLine } from '@nova-agent/tui';
import { bottomStack, sliceHistory } from '@nova-agent/tui-view';

export interface FrameBlock {
  lines: string[];
  wrapped: string[] | undefined;
  gutter?: { first: string; rest: string };
  kind?: 'user' | 'reasoning' | 'assistant' | 'tool' | 'system';
}

/** Wrap one block, caching rows until lines change or width shifts. */
export function wrapBlock(block: FrameBlock, cols: number): string[] {
  if (block.wrapped === undefined) {
    if (block.gutter === undefined) {
      block.wrapped = block.lines.flatMap((line) => wrapLine(line, cols - 1));
    } else {
      const rest = block.gutter.rest;
      const restCols = styledWidth(rest);
      const rows: string[] = [];
      let firstSeen = false;
      for (const line of block.lines) {
        const indent = /^ +/.exec(line)?.[0] ?? '';
        const body = indent.length > 0 ? line.slice(indent.length) : line;
        const budget = Math.max(10, cols - 1 - restCols - indent.length);
        for (const row of wrapLine(body, budget)) {
          if (row.length === 0) {
            rows.push('');
            continue;
          }
          rows.push((firstSeen ? rest : block.gutter.first) + indent + row);
          firstSeen = true;
        }
      }
      block.wrapped = rows;
    }
  }
  return block.wrapped;
}

/** Flatten blocks to rows with a block→row map for click hit-testing.
 *
 * Spacing contract:
 * - Within a turn: User → Reasoning → Assistant forms a cohesive unit without
 *   redundant blank rows (Question → Reasoning is 0 blank rows, Reasoning →
 *   Assistant is 0 blank rows).
 * - Without reasoning: User → Assistant keeps 1 blank row for breathing space.
 * - Between turns: 1 blank row separates different turns / other content blocks.
 */
export function flattenBlocks(
  blocks: FrameBlock[],
  cols: number,
): { flat: string[]; rowMap: { block: FrameBlock; start: number; count: number }[] } {
  const flat: string[] = [];
  const rowMap: { block: FrameBlock; start: number; count: number }[] = [];

  const active: { block: FrameBlock; wrapped: string[] }[] = [];
  for (const block of blocks) {
    const w = wrapBlock(block, cols);
    if (!w.some((row) => row.trim().length > 0)) continue;
    active.push({ block, wrapped: w });
  }

  for (let i = 0; i < active.length; i++) {
    const cur = active[i]!;
    rowMap.push({ block: cur.block, start: flat.length, count: cur.wrapped.length });
    flat.push(...cur.wrapped);

    if (i < active.length - 1) {
      const next = active[i + 1]!;
      const tight =
        (cur.block.kind === 'user' && next.block.kind === 'reasoning') ||
        (cur.block.kind === 'reasoning' && next.block.kind === 'assistant');
      if (!tight) {
        flat.push('');
      }
    }
  }

  return { flat, rowMap };
}

export { bottomStack, sliceHistory };

/** Invalidate cached wraps (e.g. on terminal resize). */
export function invalidateWraps(blocks: FrameBlock[]): void {
  for (const block of blocks) block.wrapped = undefined;
}
