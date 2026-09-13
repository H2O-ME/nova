/**
 * Reasoning, Codex-style: deltas accumulate in a memory buffer. While the
 * block streams it renders as a rolling window of plain dim text — the
 * newest REASONING_LIVE_MAX_ROWS source lines, live tail included, each
 * clipped to EXACTLY one display row (never wrapped). When the thought ends
 * the whole block disappears (fold lives in the shell): the transcript keeps
 * only the answer.
 */

import { wrapLine } from '@nova-agent/tui';
import { clipToWidth, fitTail } from './clip.js';
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
 * settled reasoning lines + the still-streaming tail, rendered as plain dim
 * rows. One source line = one display row (clipped, never wrapped): wrapped
 * fragments made the window reflow wholesale on every delta — mid-token
 * breaks, orphan continuation rows, the whole block jumping each tick. The
 * clip budget matches wrapBlock's gutter budget (cols-1-REASONING_INDENT_COLS)
 * so no row can be re-wrapped downstream; the window slides one calm row per
 * settled line. Empty buffer renders a bare static placeholder — the tail row
 * deliberately carries NO animation glyph (the composer spinner already says
 * "generating"; a cycling prefix on the newest thought re-rendered the row
 * every spinner tick for zero information).
 */
export function reasoningLiveRow(p: Palette, v: ReasoningView & { done?: readonly string[] }): string[] {
  const width = Math.max(10, v.cols - 1 - REASONING_INDENT_COLS);
  const rows: string[] = [];
  for (const line of (v.done ?? []).filter((line) => line.trim().length > 0)) {
    rows.push(clipToWidth(line, width));
  }
  const tailText = v.partial.trim();
  if (tailText.length > 0) {
    // The eye reads the tail's NEWEST words, so the streaming line keeps its
    // END (fitTail) inside the full gutter budget.
    rows.push(fitTail(tailText, width));
  }
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
