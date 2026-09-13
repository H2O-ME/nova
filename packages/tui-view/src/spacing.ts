/**
 * The single spacing rule (Codex cell contract): margins belong to each
 * cell, not to separators. Push sites never insert manual blank blocks —
 * `cli/tui/frame.ts flattenBlocks` appends one blank row after every
 * non-empty block (whitespace-only blocks are skipped outright, so empties
 * can never stack a double gap); the trailing margin of the last block is
 * trimmed, and the render layer owns the single breathing row between
 * history and the composer zone.
 *
 * `flattenBlocks` tightens this on intra-turn pairs (user→reasoning,
 * reasoning→assistant get 0 blank rows so the turn reads as one cohesive
 * unit); the base contract still holds for all other adjacencies.
 */

import { BREATHE_ROWS, HISTORY_MIN_ROWS } from './tokens.js';

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

/** Bottom stack order: history · breathing row · popups · queue · composer · status. */
export function bottomStack(
  historyLines: string[],
  popupLines: string[],
  queueLines: string[],
  composerRows: string[],
  status: string,
): string[] {
  return [...historyLines, ...Array<string>(BREATHE_ROWS).fill(''), ...popupLines, ...queueLines, ...composerRows, status];
}
