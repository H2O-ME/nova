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
  return new Flattener().flatten(blocks, cols);
}

interface FlatEntry {
  block: FrameBlock;
  /** The wrapped-rows array identity cached on the block at reconcile time. */
  wrapped: string[];
  /** Has at least one non-blank row (blank blocks leave the transcript). */
  active: boolean;
}

/**
 * Incremental block→row flattening (M10 R4, port of Grok's layout cache).
 *
 * Every store mutation clears `block.wrapped`, so (block identity, wrapped
 * array identity) is a complete dirty signal: reconcile keeps the prefix of
 * entries where both match and re-wraps only from the first divergence.
 * A streaming frame therefore costs O(#blocks) pointer compares + a
 * row-pointer copy in the join pass + wrapLine on the changed tail only —
 * the old full `flattenBlocks` re-scanned and re-wrapped the whole history
 * every tick (`trim()` allocating per row).
 */
export class Flattener {
  private entries: FlatEntry[] = [];
  private cols = -1;
  private result: { flat: string[]; rowMap: { block: FrameBlock; start: number; count: number }[] } = {
    flat: [],
    rowMap: [],
  };
  /** Block index where the last reconcile recomputed (full-hit ⇒ blocks.length). */
  lastRebuiltFrom = 0;

  /** Forget everything: next flatten rebuilds (terminal resize, session swap). */
  reset(): void {
    this.entries = [];
    this.cols = -1;
    this.result = { flat: [], rowMap: [] };
    this.lastRebuiltFrom = 0;
  }

  flatten(blocks: FrameBlock[], cols: number): { flat: string[]; rowMap: { block: FrameBlock; start: number; count: number }[] } {
    if (cols !== this.cols) {
      this.cols = cols;
      this.entries = [];
    }
    let k = 0;
    while (
      k < this.entries.length &&
      k < blocks.length &&
      this.entries[k]!.block === blocks[k] &&
      this.entries[k]!.wrapped === blocks[k]!.wrapped
    ) {
      k++;
    }
    this.lastRebuiltFrom = k;
    // Full hit ⇒ the cached entries cover exactly the block list (a prefix
    // match with a longer cache is a truncation, not a hit).
    if (k === blocks.length && this.entries.length === k) return this.result;
    this.entries.length = k;

    for (let i = k; i < blocks.length; i++) {
      const block = blocks[i]!;
      const wrapped = wrapBlock(block, cols);
      this.entries.push({ block, wrapped, active: wrapped.some((row) => row.trim().length > 0) });
    }

    const flat: string[] = [];
    const rowMap: { block: FrameBlock; start: number; count: number }[] = [];
    let hasPrev = false;
    let prevKind: FrameBlock['kind'];
    for (const entry of this.entries) {
      if (!entry.active) continue;
      // kind is optional — "no previous" and "previous kind undefined" differ.
      if (hasPrev && !isTightGap(prevKind, entry.block.kind)) flat.push('');
      rowMap.push({ block: entry.block, start: flat.length, count: entry.wrapped.length });
      for (const row of entry.wrapped) flat.push(row);
      prevKind = entry.block.kind;
      hasPrev = true;
    }
    this.result = { flat, rowMap };
    return this.result;
  }
}

/** user→reasoning and reasoning→assistant sit tight (no blank row between). */
function isTightGap(prev: FrameBlock['kind'], cur: FrameBlock['kind']): boolean {
  return (prev === 'user' && cur === 'reasoning') || (prev === 'reasoning' && cur === 'assistant');
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
