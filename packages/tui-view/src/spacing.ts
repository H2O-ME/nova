/**
 * The single spacing rule. Previously three mechanisms coexisted (leading
 * blank row inside the question block, a standalone separator block between
 * question and answer, render-layer breathing rows) — each branch carried its
 * own comment explaining the same "no blank rows inside a turn" idea.
 *
 * Rule: exactly 1 blank row BETWEEN turns; 0 blank rows INSIDE a turn
 * (question → reasoning → summary → answer → tool rows stay adjacent);
 * 1 breathing row between history and the composer zone (render layer).
 */

import { BREATHE_ROWS, HISTORY_MIN_ROWS } from './tokens.js';

/** Blank separator block lines between the question and its answer. */
export const ANSWER_SEPARATOR_LINES: string[] = [''];

/** Question block lines: no leading blank — separation owns the gap. */
export function questionLines(text: string): string[] {
  return [text];
}

/** True when an answer carries no visible content (whitespace only). */
export function isBlankAnswer(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Viewport slice: clamp the scroll offset to the known history height, then
 * cut the visible window. Short transcripts pad with blanks (top-aligned
 * document style); the emptiness sits in the middle, above the composer.
 */
export function sliceHistory(
  flat: string[],
  historyRows: number,
  scrollFromEnd: number,
): { lines: string[]; sliceStart: number; maxScroll: number } {
  const rows = Math.max(HISTORY_MIN_ROWS, historyRows);
  const maxScroll = Math.max(0, flat.length - rows);
  const clamped = Math.min(scrollFromEnd, maxScroll);
  const sliceEnd = Math.max(0, flat.length - clamped);
  const sliceStart = Math.max(0, sliceEnd - rows);
  const lines = flat.slice(sliceStart, sliceEnd);
  while (lines.length < rows) lines.push('');
  return { lines, sliceStart, maxScroll };
}

/** Bottom stack order: history · breathing row · popups · composer · status. */
export function bottomStack(
  historyLines: string[],
  popupLines: string[],
  composerRows: string[],
  status: string,
): string[] {
  return [...historyLines, ...Array<string>(BREATHE_ROWS).fill(''), ...popupLines, ...composerRows, status];
}
