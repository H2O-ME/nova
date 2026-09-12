/**
 * Reasoning, Codex-style: deltas accumulate in a memory buffer. While the
 * block streams it renders AUTO-EXPANDED (the newest reasoning lines,
 * tail-capped so long thoughts don't push the answer off screen); when the
 * block ends it folds into a single "thought" summary row — the buffer
 * becomes memory-only detail behind the click toggle.
 */

import { wrapLine } from '@nova-agent/tui';
import { fitTail } from './clip.js';
import type { Palette } from './palette.js';
import {
  REASONING_INDENT_COLS,
  REASONING_LIVE_MAX_ROWS,
  REASONING_MAX_LINES,
} from './tokens.js';

export { REASONING_INDENT_COLS, REASONING_LIVE_MAX_ROWS, REASONING_MAX_LINES };

export interface ReasoningView {
  /**
   * Live tail text (buffer tail when no header yet, else the header).
   * Kept for width/clipping parity with the old window — callers pass the
   * current display text, not the raw buffer.
   */
  partial: string;
  cols: number;
  /** Settled rows shown above the live tail while auto-expanded. */
  done?: readonly string[];
}

/**
 * The transient transcript rows while thinking: auto-expanded newest-first
 * tail (quote lane, capped at REASONING_LIVE_MAX_ROWS) plus one live tail
 * row for the still-streaming line. Empty buffer renders a bare placeholder.
 */
export function reasoningLiveRow(p: Palette, v: ReasoningView & { done?: readonly string[] }): string[] {
  const width = Math.max(10, v.cols - 1 - REASONING_INDENT_COLS - 2);
  const settled = (v.done ?? []).filter((line) => line.trim().length > 0);
  const wrapped: string[] = [];
  for (const line of settled) {
    for (const row of wrapLine(line, width)) {
      wrapped.push(row);
    }
  }
  const tailText = v.partial.trim();
  const tail = tailText.length > 0
    // '⋯' is 2 cols + 1 space = 3-col prefix.
    ? `⋯ ${fitTail(tailText, Math.max(1, width - 3))}`
    : '⋯';
  const cap = Math.max(1, REASONING_LIVE_MAX_ROWS - 1);
  const visible = wrapped.slice(-cap);
  const rows = visible.map((row) => p.dim(`│ ${row}`));
  if (settled.length === 0 && tailText.length === 0) return [p.dim('⋯')];
  rows.push(p.dim(`│ ${tail}`));
  return rows;
}

/**
 * Folded summary row (▸/▾ is the click affordance; toggling lives in the
 * shell). Full text lives in session memory only — reasoning never hits disk,
 * so resumed summaries are plain text and not expandable.
 */
export function summaryRow(p: Palette, secs: number, expanded: boolean): string {
  return p.dim(`${expanded ? '▾' : '▸'} 已思考 ${secs}s`);
}

/** Expanded full text: guided by a dim quote lane, keeping clear separation from the answer. */
export function reasoningDetailRows(p: Palette, lines: readonly string[], cols?: number): string[] {
  const width = cols !== undefined ? Math.max(10, cols - 1 - REASONING_INDENT_COLS - 2) : undefined;
  const rows: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      rows.push(p.dim('│'));
      continue;
    }
    if (width !== undefined) {
      for (const row of wrapLine(line, width)) {
        rows.push(p.dim(`│ ${row}`));
      }
    } else {
      rows.push(p.dim(`│ ${line}`));
    }
  }
  return rows;
}
