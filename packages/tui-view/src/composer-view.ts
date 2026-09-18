/**
 * Composer zone: input window, spinner lead, cursor math (pure, zero IO).
 * The shell passes a layout snapshot + frame state per render.
 */

import { styledWidth } from '@nova-agent/tui';
import { clipToWidth } from './clip.js';
import { cardBottom, cardRow, cardTop, CHROME_PAD_COLS } from './layout.js';
import { SPINNER_FRAMES } from './tokens.js';
import type { Palette } from './palette.js';

/** Generation phase (composer lead spinner coloring). */
export type GenPhase = 'idle' | 'thinking' | 'writing' | 'tool';

/**
 * Composer prompt prefix: `  ❯ ` = 4 display columns. The width is the source
 * of truth for wrap budget / cursor column / continuation indent, so it is a
 * literal (never derived from a styled string, whose escapes would leak).
 */
export const COMPOSER_PREFIX_WIDTH = 4;

/** The caret itself, painted through the injected palette (light theme ≠ cyan). */
export function composerLead(p: Palette): string {
  return `  ${p.cyan(p.bold('❯'))} `;
}

/** Wrap budget inside the composer: prompt prefix + right margin + caret. */
export function composerWrapBudget(cols: number): number {
  return Math.max(1, cols - COMPOSER_PREFIX_WIDTH - 2);
}

export interface ComposerZoneView {
  spinnerFrame: number;
  streaming: boolean;
  genPhase: GenPhase;
  /** Dim hint in the empty first row — the caret rests on its first char. */
  placeholder?: string;
}

/**
 * 空输入时的占位提示。Grok 的设计语言里这一行**只说"在这里输入"**——键位属于
 * 底部快捷键条（hint-bar），开屏卡片也不重复。原先把 `Esc 中断 · Ctrl+C×2 退出`
 * 塞进占位行，等于哪儿都在说、哪儿都不像设计。
 */
export const COMPOSER_PLACEHOLDER = '描述任务…';

/** 输入卡片左右内衬（Grok `prompt_inset(false) = 2`）。 */
export const COMPOSER_H_PAD = CHROME_PAD_COLS;
/** 卡片比裸输入行多出的行数：顶框 + 底框（底框兼 info 行）。 */
export const COMPOSER_CARD_ROWS = 2;

export interface ComposerCardView extends ComposerZoneView {
  cols: number;
  /** 底框右缘的输入元信息（空则整段省略，Grok 的 `!info.is_blank()` 守卫）。 */
  info?: string;
}

export function composerCardWidth(cols: number): number {
  return Math.max(20, cols - COMPOSER_H_PAD * 2);
}

/** 输入区卡片：`╭─╮ / │ ❯ 输入 │ / ╰─ info ─╯`（Grok 单行草稿恒 3 行）。 */
export function composerCard(p: Palette, layout: ComposerLayout, v: ComposerCardView): string[] {
  const spec = { width: composerCardWidth(v.cols), ...(v.info === undefined || v.info === '' ? {} : { info: v.info }) };
  const lead = ' '.repeat(COMPOSER_H_PAD);
  return [
    lead + cardTop(p, spec),
    ...composerZone(p, layout, v).map((row) => lead + cardRow(p, spec, row, 0)),
    lead + cardBottom(p, spec),
  ];
}

/** 底框 info：只放输入区自己的状态（行/字/排队），不与状态栏重复。 */
export function composerInfo(v: { rows: number; cursorRow: number; chars: number; queued: number }): string {
  const bits: string[] = [];
  if (v.rows > 1) bits.push(`第 ${v.cursorRow + 1}/${v.rows} 行`);
  if (v.chars > 0) bits.push(`${v.chars} 字`);
  if (v.queued > 0) bits.push(`排队 ${v.queued}`);
  return bits.join(' · ');
}

/** Up to COMPOSER_MAX_ROWS wrapped input rows with overflow hints. */
export function composerZone(p: Palette, layout: ComposerLayout, v: ComposerZoneView): string[] {
  const zone: string[] = [];
  if (layout.hiddenAbove > 0) zone.push(`  ${p.dim(`⋯ 上方还有 ${layout.hiddenAbove} 行`)}`);
  const indent = ' '.repeat(COMPOSER_PREFIX_WIDTH);
  // While streaming the ❯ lead becomes a spinner frame (same 1-col width);
  // frame color follows genPhase (thinking/writing green, tool yellow).
  const frame = SPINNER_FRAMES[v.spinnerFrame % SPINNER_FRAMES.length] ?? '•';
  const lead0 = v.streaming ? `  ${v.genPhase === 'tool' ? p.yellow(frame) : p.green(frame)} ` : composerLead(p);
  const ph = v.placeholder ?? '';
  layout.rows.forEach((row, i) => {
    const lead = i === 0 && layout.hiddenAbove === 0 ? lead0 : indent;
    const empty = i === 0 && layout.hiddenAbove === 0 && row.text === '' && row.caretIdx === 0 && ph.length > 0;
    // Caret stays a block on its own cell with the hint one column over: an
    // inverse block *on* a CJK hint char just eats a glyph and reads as a
    // corrupted character.
    zone.push(lead + (empty ? `${p.inverse(' ')}${p.dim(ph)}` : renderComposerRow(p, row)));
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
  /** 输入卡片顶框行数（光标落在卡片第二行上）。 */
  leadRows?: number;
  layout: ComposerLayout;
}): { row: number; col: number } {
  const hintRows = v.layout.hiddenAbove > 0 ? 1 : 0;
  return {
    row: v.historyRows + 1 + v.popupRows + (v.queueRows ?? 0) + (v.leadRows ?? 0) + hintRows + v.layout.cursorRow,
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

// ---- paste chips (Grok 组件8): display-only fold over the buffer ----

/** A chip is a UTF-16 range of `input` rendered as one badge cell-run. */
export interface ComposerChip {
  start: number;
  end: number;
}

/** `⧉ 粘贴 24行 1.2k字` — plain-text badge (wrap math is ANSI-free by contract). */
export function chipBadge(input: string, chip: ComposerChip): string {
  const seg = input.slice(chip.start, chip.end);
  const lines = (seg.match(/\n/g)?.length ?? 0) + 1;
  const chars = [...seg].length;
  return `⧉ 粘贴 ${lines}行 ${chars > 999 ? `${(chars / 1000).toFixed(1)}k` : chars}字`;
}

export interface ChipFold {
  /** Input with every chip range replaced by its badge. */
  text: string;
  /** Buffer unit → display unit; interior positions clamp to the badge edge. */
  toDisplay(buf: number, side?: 'start' | 'end'): number;
  /** Display unit → buffer unit; badge interior maps to the chip boundary. */
  toBuffer(disp: number): number;
}

/**
 * Fold chips out of the display WITHOUT touching the buffer (the submit path
 * still sees the full pasted text). The cursor is only ever parked on chip
 * boundaries by the key chain, so `toBuffer` needs just two rules: badge
 * interior → chip.start, exactly past a badge → chip.end.
 */
export function foldChips(input: string, chips: readonly ComposerChip[]): ChipFold {
  const sorted = [...chips].sort((a, b) => a.start - b.start);
  const badges: { dStart: number; dEnd: number; chip: ComposerChip }[] = [];
  let text = '';
  let prev = 0;
  for (const c of sorted) {
    if (c.start < prev || c.end <= c.start || c.end > input.length) continue; // defensive: skip malformed
    text += input.slice(prev, c.start);
    const badge = chipBadge(input, c);
    badges.push({ dStart: text.length, dEnd: text.length + badge.length, chip: c });
    text += badge;
    prev = c.end;
  }
  text += input.slice(prev);
  const shiftTo = (buf: number): number => {
    let shift = 0;
    for (const b of badges) {
      if (b.chip.end <= buf) shift += b.dEnd - b.dStart - (b.chip.end - b.chip.start);
      else if (b.chip.start >= buf) break;
    }
    return buf + shift;
  };
  return {
    text,
    toDisplay(buf, side = 'start'): number {
      for (const b of badges) {
        if (buf > b.chip.start && buf < b.chip.end) return side === 'end' ? b.dEnd : b.dStart;
        if (buf === b.chip.end && side !== 'end') return b.dEnd; // 边界右缘：光标在徽章之后
        if (buf === b.chip.start && side === 'end') return b.dEnd;
      }
      return shiftTo(buf);
    },
    toBuffer(disp): number {
      for (const b of badges) {
        if (disp >= b.dStart && disp < b.dEnd) return b.chip.start;
        if (disp === b.dEnd) return b.chip.end;
      }
      let shift = 0;
      for (const b of badges) {
        if (disp > b.dEnd) shift += b.dEnd - b.dStart - (b.chip.end - b.chip.start);
        else if (disp <= b.dStart) break;
      }
      return disp - shift;
    },
  };
}
