/**
 * Frame helpers: block wrapping with gutter-aware hanging indent, history
 * flattening, and bottom-stack assembly. The shell owns blocks and the
 * screen; this module owns the row math so it stays unit-testable.
 */

import { styledWidth, wrapLine } from '@nova-agent/tui';
import { bottomStack, permissionLabel, sliceHistory, toolArgSummary, toolLabel, type Palette } from '@nova-agent/tui-view';
import type { CommandSpec } from '../commands.js';
import { buildApprovalPopup, buildCommandPopup, buildModelPopup, buildSessionPopup } from '@nova-agent/tui-view';
import type { TuiStore } from './store.js';

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

/** 弹窗数据源（store 快照 + 少量外部读取器），使 resolveActiveView 保持纯。 */
export interface ActiveViewDeps {
  commandMatches: CommandSpec[];
  /** models.dev 元数据查询（/model 面板逐条标上下文容量）。 */
  modelContextTokens(name: string): number | undefined;
  currentModel: string;
  currentSessionFile: string;
}

/**
 * 活动弹窗纯选择（阶段 E 出壳自 renderFrame）：审批 > 模型选择 > 会话选择 >
 * 命令面板，一次至多一个；四者优先级与行构造此前长在壳层闭包里。commandMatches
 * 传过滤后的匹配（popupDismissed 由本函数直接读 store）。
 */
export function resolveActiveView(store: TuiStore, paint: Palette, cols: number, deps: ActiveViewDeps): string[] {
  if (store.approval !== undefined) {
    return buildApprovalPopup(
      paint,
      {
        permissionLabel: permissionLabel(store.approval.kind),
        toolLabel: toolLabel(store.approval.call.name),
        argSummary: toolArgSummary(store.approval.call.name, store.approval.call.rawArgs, 100),
        previewLines: store.approvalPreview,
        index: store.approvalIndex,
        isExecuteKind: store.approval.kind === 'execute',
      },
      cols,
    );
  }
  if (store.modelPicker !== undefined) {
    // Model catalog in a bordered panel with a sliding window: long lists
    // scroll inside the popup instead of flooding the transcript.
    return buildModelPopup(
      paint,
      {
        items: store.modelPicker.models.map((name) => ({
          name,
          contextTokens: deps.modelContextTokens(name),
        })),
        index: store.modelPicker.index,
        current: deps.currentModel,
      },
      cols,
    );
  }
  if (store.sessionPicker !== undefined) {
    // Session switcher: bordered panel like the model picker, a sliding
    // window over the newest sessions, current one marked.
    return buildSessionPopup(
      paint,
      {
        items: store.sessionPicker.entries.map((entry) => ({
          mtime: entry.mtime,
          title: entry.title,
          isCurrent: entry.file === deps.currentSessionFile,
        })),
        index: store.sessionPicker.index,
      },
      cols,
    );
  }
  if (store.popupDismissed || deps.commandMatches.length === 0) return [];
  // Bordered dropdown matching the composer box; the selected row is
  // inverse-video across the full row width, not just the label.
  // buildCommandPopup owns the sliding window + relative highlight — the
  // caller used to pre-slice AND pass the absolute index, which threw the
  // selection outside the visible list.
  return buildCommandPopup(paint, { matches: deps.commandMatches, index: store.popupIndex }, cols);
}
