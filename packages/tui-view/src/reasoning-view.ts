/**
 * Reasoning, Codex-style: deltas accumulate in a memory buffer. While the
 * block streams it renders as a scrolling window of plain dim text — the
 * newest REASONING_LIVE_MAX_ROWS wrapped rows, live tail included. When the
 * thought ends the whole block disappears (fold lives in the shell): the
 * transcript keeps only the answer.
 */

import { wrapLine } from '@nova-agent/tui';
import type { Palette } from './palette.js';
import { REASONING_INDENT_COLS, REASONING_LIVE_MAX_ROWS, REASONING_MAX_LINES } from './tokens.js';

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
 * The transient transcript rows while thinking: a rolling window over the
 * wrapped reasoning text (settled lines + the still-streaming tail), rendered
 * as plain dim rows — no quote lane, no ⋯ marker. Empty buffer renders a bare
 * placeholder. Rows beyond the cap scroll out of the window (newest kept).
 */
export function reasoningLiveRow(p: Palette, v: ReasoningView & { done?: readonly string[] }): string[] {
  const width = Math.max(10, v.cols - 1 - REASONING_INDENT_COLS);
  const rows: string[] = [];
  for (const line of (v.done ?? []).filter((line) => line.trim().length > 0)) {
    rows.push(...wrapLine(line, width));
  }
  const tailText = v.partial.trim();
  if (tailText.length > 0) rows.push(...wrapLine(tailText, width));
  if (rows.length === 0) return [p.dim('⋯')];
  return rows.slice(-REASONING_LIVE_MAX_ROWS).map((row) => p.dim(row));
}

/**
 * Folded summary row (▸/▾ is the click affordance; toggling lives in the
 * shell). The shell no longer folds reasoning into a summary by default, but
 * the row type stays for resumed/edge surfaces.
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
