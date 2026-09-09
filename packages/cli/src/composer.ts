/**
 * Composer 显示区的纯计算：输入行窗口、spinner 前导、光标定位。
 * 零终端 IO——壳层（tui-mode）每帧把可变状态（spinner 帧号/流式态/生成
 * 阶段）与 layoutComposer 的布局结果作为快照传进来。COMPOSER_PREFIX 是
 * 这一区的锚：换行预算与光标列数都以它的宽度为基准。
 */

import { styledWidth } from '@nova-agent/tui';
import { SPINNER_FRAMES, type ComposerLayout, type ComposerRow, type Palette } from './ui.js';

/** 生成阶段（composer 前导 spinner 的着色依据；壳层的可变状态经视图传入）。 */
export type GenPhase = 'idle' | 'thinking' | 'writing' | 'tool';

/** Composer prompt prefix; the cursor column math depends on its width. */
export const COMPOSER_PREFIX = `  \x1b[36m\x1b[1m❯\x1b[0m `;
export const COMPOSER_PREFIX_WIDTH = styledWidth(COMPOSER_PREFIX);

/** Wrap budget inside the composer: prompt prefix + right margin + caret cell. */
export function composerWrapBudget(cols: number): number {
  return Math.max(1, cols - COMPOSER_PREFIX_WIDTH - 2);
}

export interface ComposerZoneView {
  /** spinner tick 的自增帧号（着色取模用）。 */
  spinnerFrame: number;
  streaming: boolean;
  genPhase: GenPhase;
}

/**
 * The composer zone: up to COMPOSER_MAX_ROWS wrapped input rows between
 * optional "more above/below" hints. The first visible row carries the
 * `❯` prompt; continuation rows align under it.
 */
export function composerZone(p: Palette, layout: ComposerLayout, v: ComposerZoneView): string[] {
  const zone: string[] = [];
  if (layout.hiddenAbove > 0) zone.push(`  ${p.dim(`⋯ 上方还有 ${layout.hiddenAbove} 行`)}`);
  const indent = ' '.repeat(COMPOSER_PREFIX_WIDTH);
  // 流式时 ❯ 原位换成 spinner 帧（同为 1 列宽）：动画留在输入行上，
  // 底部状态行不再被逐帧 tick 牵动。帧色跟 genPhase——思考/写作绿、
  // 等工具黄，和右缘 tps 仪表的"是否在生成"同义。
  const frame = SPINNER_FRAMES[v.spinnerFrame % SPINNER_FRAMES.length] ?? '•';
  const lead0 = v.streaming ? `  ${v.genPhase === 'tool' ? p.yellow(frame) : p.green(frame)} ` : COMPOSER_PREFIX;
  layout.rows.forEach((row, i) => {
    const lead = i === 0 && layout.hiddenAbove === 0 ? lead0 : indent;
    zone.push(lead + renderComposerRow(p, row));
  });
  if (layout.hiddenBelow > 0) zone.push(`  ${p.dim(`⋯ 下方还有 ${layout.hiddenBelow} 行`)}`);
  return zone;
}

/** One input row; the caret renders as an inverse block on the char it sits on. */
export function renderComposerRow(p: Palette, row: ComposerRow): string {
  if (row.caretIdx < 0) return row.text;
  const rest = row.text.slice(row.caretIdx);
  const at = [...rest][0] ?? ' ';
  return `${row.text.slice(0, row.caretIdx)}${p.inverse(at)}${rest.slice(at.length)}`;
}

/**
 * 光标行列：history · breathe · popup · composer zone · status。光标行落在
 * zone 内——"上方还有"提示（若有）占 zone 首行、整体下移一行；+1 跨过
 * history 与弹窗/composer 区之间的呼吸行。popupRows 传 renderFrame 已构造
 * 的弹窗**实际**行数（旧版 popupHeight() 是并行的第二套推导，两套实现
 * 手动同步——现以单一来源为准）。
 */
export function cursorPosition(v: {
  historyRows: number;
  popupRows: number;
  layout: ComposerLayout;
}): { row: number; col: number } {
  const hintRows = v.layout.hiddenAbove > 0 ? 1 : 0;
  return {
    row: v.historyRows + 1 + v.popupRows + hintRows + v.layout.cursorRow,
    col: COMPOSER_PREFIX_WIDTH + v.layout.cursorCol,
  };
}
