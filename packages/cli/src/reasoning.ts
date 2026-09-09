import { fitTail, type Palette } from './ui.js';

/** Committed reasoning lines kept in the live window; the tail row joins them. */
export const REASONING_MAX_LINES = 2;

/** 思考块的 gutter 缩进（每行都落在正文列，首行无标记）。行宽预算必须与
 *  wrapBlock 允许的一致，否则行会被二次折行，定高承诺就破了。 */
const REASONING_INDENT_COLS = 4;

export interface ReasoningView {
  /** Committed (newline-sealed) reasoning lines, oldest first. */
  done: readonly string[];
  /** The still-streaming line (no newline seen yet). */
  partial: string;
  cols: number;
}

/**
 * 思考过程活窗口：已定格行（暗色、单行裁剪）+ 一行活尾（⋯ 开头，承载最新
 * 文本）。**每行都裁到单一显示行、绝不换行**——块高只在窗口填满前从 1 涨到
 * 3（此时它是转录区最后一块，下方无内容可推），之后每个 delta 只重写活尾
 * 一行。旧形态把未换行的 240 字符活尾交给 wrapBlock 折成数行、定格行原样
 * 入块：每个 delta 整块重折，窗口以流速度抖动，看起来是整段重排 + 卡顿，
 * 而不是文字在流动。思考是过程性内容，结束后整段折成「已思考 Ns」，正文
 * 不留档——裁剪掉的行尾不丢任何持久信息。
 */
export function reasoningRows(p: Palette, v: ReasoningView): string[] {
  const width = Math.max(10, v.cols - 1 - REASONING_INDENT_COLS);
  const rows = v.done
    .filter((line) => line.trim().length > 0)
    .map((line) => p.dim(fitTail(line, width)));
  // '⋯' 占 2 列 + 空格 1 列 = 前缀 3 列（终端按宽字符计）。
  rows.push(p.dim(`⋯ ${fitTail(v.partial, Math.max(1, width - 3))}`));
  return rows;
}
