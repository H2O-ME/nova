/**
 * Reasoning live window: committed rows (dim, one display row each) plus one
 * live tail row (`⋯` lead). Block height stays fixed once full — each delta
 * repaints only the tail row, nothing re-wraps, nothing reflows.
 */

import { fitTail } from './clip.js';
import type { Palette } from './palette.js';
import { REASONING_INDENT_COLS, REASONING_MAX_LINES } from './tokens.js';

export { REASONING_INDENT_COLS, REASONING_MAX_LINES };

export interface ReasoningView {
  /** Committed (newline-sealed) lines, oldest first. */
  done: readonly string[];
  /** Still-streaming line (no newline seen yet). */
  partial: string;
  cols: number;
}

export function reasoningRows(p: Palette, v: ReasoningView): string[] {
  const width = Math.max(10, v.cols - 1 - REASONING_INDENT_COLS);
  const rows = v.done
    .filter((line) => line.trim().length > 0)
    .map((line) => p.dim(fitTail(line, width)));
  // '⋯' is 2 cols + 1 space = 3-col prefix.
  rows.push(p.dim(`⋯ ${fitTail(v.partial, Math.max(1, width - 3))}`));
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

/** Expanded full text: blank lines stay blank, soft wrap via gutter budget. */
export function reasoningDetailRows(p: Palette, lines: readonly string[]): string[] {
  return lines.map((line) => (line.trim().length === 0 ? '' : p.dim(line)));
}
