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
 * cut the visible window. Short transcripts pad with blanks at the tail —
 * where that padding belongs is a separate decision (see `anchorHistory`).
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

/** 视口富余空白的落点：开屏 / 贴底直播 / 已上滚（上滚时内容本就顶到视口上缘，不挪）。 */
export type HistoryAnchor = 'welcome' | 'tail' | 'none';

/**
 * 把 `sliceHistory` 沉在尾部的空白挪到内容上方——整帧终端里"文档流"的唯一正确翻译。
 *
 * Grok 的 scrollback 是个 pane，内容在 pane 里自上而下流，富余空白落在内容与 prompt
 * 之间却看不出来：pane 上缘压着一行常驻 StatusBar，且欢迎页是占满整屏的 overlay，
 * 所以"短内容 + 中间空洞"那个组合在它那儿几乎不出现。Nova 是 alt-screen 整帧、
 * 底部栈把 composer 钉死在屏幕下缘——同样的文档流就把最新一行推离输入区半屏，
 * 眼睛每次都要跨过空洞去找"我该接着看哪儿"。所以贴底时空白整段上浮，最新一行
 * 永远贴着 composer（呼吸行隔开）；空白改落在屏幕顶缘，读起来像"上面还有历史"。
 *
 * 开屏阶段例外：首轮提交前只挪富余的 1/3（Grok welcome 的 remaining/3），其余沉底
 * ——一张卡片浮在屏幕上部是欢迎页该有的姿态，贴着输入框就不是了。
 *
 * 返回 `topPad`（合成空白行数）：点击行号要先减它才落回内容坐标。
 */
export function anchorHistory(
  lines: string[],
  contentRows: number,
  mode: HistoryAnchor,
): { lines: string[]; topPad: number } {
  const slack = Math.max(0, lines.length - contentRows);
  const topPad = mode === 'tail' ? slack : mode === 'welcome' ? Math.floor(slack / 3) : 0;
  if (topPad === 0) return { lines, topPad: 0 };
  return { lines: [...Array<string>(topPad).fill(''), ...lines.slice(0, lines.length - topPad)], topPad };
}

/** Bottom stack order: history · breathing row · popups · queue · composer · status · hints. */
export function bottomStack(
  historyLines: string[],
  popupLines: string[],
  queueLines: string[],
  composerRows: string[],
  status: string,
  /** 滚动位置提示复用呼吸行（空串=普通空行；不占内容行、不进状态栏）。 */
  breathText?: string,
  /** 屏幕最后一行的快捷键条（Grok 底部栈：prompt → status_line → shortcuts）。 */
  hints?: string,
): string[] {
  const breath = Array<string>(BREATHE_ROWS).fill(breathText ?? '');
  const tail = hints === undefined || hints === '' ? [] : [hints];
  return [...historyLines, ...breath, ...popupLines, ...queueLines, ...composerRows, status, ...tail];
}
