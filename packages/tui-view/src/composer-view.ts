/**
 * Composer zone: input window, spinner lead, cursor math (pure, zero IO).
 * The shell passes a layout snapshot + frame state per render.
 */

import { styledWidth } from '@nova-agent/tui';
import { clipToWidth } from './clip.js';
import { SPINNER_FRAMES } from './tokens.js';
import type { Palette } from './palette.js';

/** Generation phase (composer lead spinner coloring). */
export type GenPhase = 'idle' | 'thinking' | 'writing' | 'tool';

/** Composer prompt prefix; cursor column math depends on its width. */
export const COMPOSER_PREFIX = `  \x1b[36m\x1b[1m❯\x1b[0m `;
export const COMPOSER_PREFIX_WIDTH = styledWidth(COMPOSER_PREFIX);

/** Wrap budget inside the composer: prompt prefix + right margin + caret. */
export function composerWrapBudget(cols: number): number {
  return Math.max(1, cols - COMPOSER_PREFIX_WIDTH - 2);
}

export interface ComposerZoneView {
  spinnerFrame: number;
  streaming: boolean;
  genPhase: GenPhase;
}

/** Up to COMPOSER_MAX_ROWS wrapped input rows with overflow hints. */
export function composerZone(p: Palette, layout: ComposerLayout, v: ComposerZoneView): string[] {
  const zone: string[] = [];
  if (layout.hiddenAbove > 0) zone.push(`  ${p.dim(`⋯ 上方还有 ${layout.hiddenAbove} 行`)}`);
  const indent = ' '.repeat(COMPOSER_PREFIX_WIDTH);
  // While streaming the ❯ lead becomes a spinner frame (same 1-col width);
  // frame color follows genPhase (thinking/writing green, tool yellow).
  const frame = SPINNER_FRAMES[v.spinnerFrame % SPINNER_FRAMES.length] ?? '•';
  const lead0 = v.streaming ? `  ${v.genPhase === 'tool' ? p.yellow(frame) : p.green(frame)} ` : COMPOSER_PREFIX;
  layout.rows.forEach((row, i) => {
    const lead = i === 0 && layout.hiddenAbove === 0 ? lead0 : indent;
    zone.push(lead + renderComposerRow(p, row));
  });
  if (layout.hiddenBelow > 0) zone.push(`  ${p.dim(`⋯ 下方还有 ${layout.hiddenBelow} 行`)}`);
  return zone;
}

/** One input row; the caret renders as an inverse block on its char. */
export function renderComposerRow(p: Palette, row: ComposerRow): string {
  if (row.caretIdx < 0) return row.text;
  const rest = row.text.slice(row.caretIdx);
  const at = [...rest][0] ?? ' ';
  return `${row.text.slice(0, row.caretIdx)}${p.inverse(at)}${rest.slice(at.length)}`;
}

/** Cursor row/col: history + breathing row + popup + zone offset. */
export function cursorPosition(v: {
  historyRows: number;
  popupRows: number;
  queueRows?: number;
  layout: ComposerLayout;
}): { row: number; col: number } {
  const hintRows = v.layout.hiddenAbove > 0 ? 1 : 0;
  return {
    row: v.historyRows + 1 + v.popupRows + (v.queueRows ?? 0) + hintRows + v.layout.cursorRow,
    col: COMPOSER_PREFIX_WIDTH + v.layout.cursorCol,
  };
}

/** Newest messages shown from the queue before the overflow hint takes over. */
export const MESSAGE_QUEUE_SHOW = 3;

/**
 * Queued-message rows (mid-turn enqueue): a dim lane pinned between the
 * transcript and the composer so "what I typed while the agent was busy" is
 * always visible, newest last. Single-line rows; multiline input collapses
 * to one spaced line.
 */
export function messageQueueRows(p: Palette, queue: readonly string[], cols: number): string[] {
  if (queue.length === 0) return [];
  const rows: string[] = [];
  const hidden = queue.length - MESSAGE_QUEUE_SHOW;
  if (hidden > 0) rows.push(clipToWidth(`  ${p.dim(`┃ 排队中 · 还有 ${hidden} 条…`)}`, Math.max(8, cols - 1)));
  for (const text of queue.slice(-MESSAGE_QUEUE_SHOW)) {
    const oneLine = text.replace(/\s+/gu, ' ').trim();
    rows.push(clipToWidth(`  ${p.dim('┃')} ${p.dim(oneLine)}`, Math.max(8, cols - 1)));
  }
  return rows;
}

export interface ComposerWrap {
  rows: string[];
  /** Row holding the caret. */
  caretRow: number;
  /** Display columns left of the caret on that row. */
  caretCol: number;
  /** UTF-16 offset of each row's first char (for vertical moves). */
  rowStart: number[];
}

/** Split input into display rows (explicit + soft wraps), locating the caret. */
export function wrapComposer(input: string, cursorPos: number, width: number): ComposerWrap {
  const w = Math.max(1, width);
  const rows: string[] = [];
  const rowStart: number[] = [];
  let cur = '';
  let curW = 0;
  let curStart = 0;
  let units = 0;
  let caretRow = 0;
  let caretCol = 0;
  let caretSeen = false;
  const closeRow = (): void => {
    rows.push(cur);
    rowStart.push(curStart);
    cur = '';
    curW = 0;
  };
  for (const ch of input) {
    if (!caretSeen && units >= cursorPos) {
      caretRow = rows.length;
      caretCol = curW;
      caretSeen = true;
    }
    if (ch === '\n') {
      closeRow();
      units += 1;
      curStart = units;
      continue;
    }
    const cw = styledWidth(ch);
    if (curW > 0 && curW + cw > w) {
      closeRow();
      curStart = units;
    }
    cur += ch;
    curW += cw;
    units += ch.length;
  }
  if (!caretSeen) {
    caretRow = rows.length;
    caretCol = curW;
  }
  closeRow();
  return { rows, caretRow, caretCol, rowStart };
}

export interface ComposerRow {
  text: string;
  /** UTF-16 offset of the caret within this row; -1 when elsewhere. */
  caretIdx: number;
}

export interface ComposerLayout {
  rows: ComposerRow[];
  cursorRow: number;
  cursorCol: number;
  totalRows: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

/** Visible window of at most maxRows around the caret row. */
export function layoutComposer(input: string, cursorPos: number, width: number, maxRows: number): ComposerLayout {
  const wrap = wrapComposer(input, cursorPos, width);
  const total = wrap.rows.length;
  const max = Math.max(1, maxRows);
  const start = total <= max ? 0 : Math.max(0, Math.min(wrap.caretRow - (max - 1), total - max));
  const slice = wrap.rows.slice(start, start + max);
  const rows: ComposerRow[] = slice.map((text) => ({ text, caretIdx: -1 }));
  if (wrap.caretRow >= start && wrap.caretRow < start + slice.length) {
    rows[wrap.caretRow - start] = { text: slice[wrap.caretRow - start] ?? '', caretIdx: caretIdxInRow(slice[wrap.caretRow - start] ?? '', wrap.caretCol) };
  }
  return {
    rows,
    cursorRow: Math.max(0, Math.min(slice.length - 1, wrap.caretRow - start)),
    cursorCol: wrap.caretCol,
    totalRows: total,
    hiddenAbove: start,
    hiddenBelow: Math.max(0, total - (start + slice.length)),
  };
}

function caretIdxInRow(text: string, caretCol: number): number {
  let acc = 0;
  let units = 0;
  for (const ch of text) {
    if (acc >= caretCol) return units;
    acc += styledWidth(ch);
    units += ch.length;
  }
  return text.length;
}

/** ↑/↓ in multiline input: keep the visual column, clamp at short rows. */
export function cursorAfterVerticalMove(input: string, cursorPos: number, width: number, delta: number): number {
  const wrap = wrapComposer(input, cursorPos, width);
  const target = Math.max(0, Math.min(wrap.rows.length - 1, wrap.caretRow + delta));
  if (target === wrap.caretRow) return cursorPos;
  const idx = caretIdxInRow(wrap.rows[target] ?? '', wrap.caretCol);
  return (wrap.rowStart[target] ?? 0) + idx;
}
