/**
 * 设计语言底座（Grok 度量逐值移植）。
 *
 * Nova 的视图层原本只有"字符串行 + 各自手算宽度"，没有分区/内衬/边框/分隔符
 * 的原语——于是每个组件都重发明一遍 pad 与裁剪，一处算错整块错位。这里把
 * Grok 实际在用的那套常量收进来，组件只做声明：
 *
 * - 屏幕分区：转录区是**唯一**会收缩的区，其余全是定长行（Grok agent.rs:228-299）。
 * - 水平列：`accent(1) | left_pad(2) | content | right_pad(2)`，accent 列即使
 *   不画也占位，所以所有块的左缘恒在同一列（Grok scrollback/layout.rs:17-43）。
 * - 卡片：圆角细线 `╭─╮│╰─╯`，顶框右缘可嵌 caption、底框右缘可嵌 info，
 *   `╮`/`╯` 前留 2 格（Grok prompt_widget/mod.rs:3007-3323、:3027-3047）。
 * - 分隔符两种宽度不通用：状态簇 `" │ "`（3 列）、快捷键簇 `"  │  "`（5 列）。
 */

import { styledWidth } from '@nova-agent/tui';
import { clipToWidth } from './clip.js';
import type { Palette } from './palette.js';

/** 转录列宽（Grok chrome_width）：accent 1 + 左 2 + 右 2。 */
export const CHROME_ACCENT_COLS = 1;
export const CHROME_PAD_COLS = 2;
export const CHROME_WIDTH = CHROME_ACCENT_COLS + CHROME_PAD_COLS * 2;

/** 内容宽 = 终端列数 - 左右内衬（Grok 外层 hpad 2/2 之后的 content 宽）。 */
export function contentWidth(cols: number): number {
  return Math.max(8, cols - CHROME_PAD_COLS * 2);
}

/** 状态条簇分隔符（3 列）。 */
export const STATUS_SEP = ' │ ';
/** 快捷键条簇分隔符（5 列）——Grok 两条分隔符宽度不同，别统一。 */
export const HINT_SEP = '  │  ';

/**
 * 一行里的分段：`键:动作` 之类。逐项、逐项内分段判宽，超宽就**整条从尾部丢**
 * （丢的顺序：分隔符 → 键 → 冒号 → 动作），不折行、不加省略号（Grok
 * shortcuts_bar.rs:265-291）。
 */
export function segRow(
  items: readonly { readonly text: string; readonly style: (s: string) => string }[],
  sep: string,
  cols: number,
): string {
  let out = '';
  let w = 0;
  for (const [i, item] of items.entries()) {
    const piece = i === 0 ? item.text : sep + item.text;
    const pw = styledWidth(piece);
    if (w + pw > cols) break;
    out += i === 0 ? item.style(item.text) : `${sep}${item.style(item.text)}`;
    w += pw;
  }
  return out;
}

export interface CardSpec {
  /** 卡片占用的总列数（含左右边框）。 */
  width: number;
  /** 顶框右缘的 caption（Grok 用它放标题；`╮` 前留 2 格）。 */
  caption?: string;
  /** 底框右缘的 info（Grok 用它放模型/flag；空则整段省略）。 */
  info?: string;
}

const CORNER_TL = '╭';
const CORNER_TR = '╮';
const CORNER_BL = '╰';
const CORNER_BR = '╯';
const H_LINE = '─';
const V_LINE = '│';

/** 卡片顶框：`╭─…[ caption ]─╮`，caption 右对齐、距右角 2 格。 */
export function cardTop(p: Palette, s: CardSpec): string {
  return cardEdge(p, s, CORNER_TL, CORNER_TR, s.caption);
}

/** 卡片底框：`╰─…[ info ]─╯`。 */
export function cardBottom(p: Palette, s: CardSpec): string {
  return cardEdge(p, s, CORNER_BL, CORNER_BR, s.info);
}

function cardEdge(p: Palette, s: CardSpec, left: string, right: string, edge: string | undefined): string {
  const label = edge === undefined || edge.length === 0 ? undefined : clipToWidth(edge, Math.max(0, s.width - 6));
  const labelW = label === undefined ? 0 : styledWidth(label) + 2; // 两侧各 1 格呼吸
  const dashes = Math.max(0, s.width - 2 - (label === undefined ? 0 : labelW));
  const line = p.border(H_LINE.repeat(dashes));
  const mid = label === undefined ? line : `${line}${p.border(' ')}${label}${p.border(' ')}`;
  return `${p.border(left)}${mid}${p.border(right)}`;
}

/**
 * 卡片正文行：左右 `│` + 内衬。`pad` 是正文前的固定缩进（Grok
 * chrome_pad_left=2），行尾补空格到框宽。
 */
export function cardRow(p: Palette, s: CardSpec, text: string, pad = 2): string {
  const inner = Math.max(0, s.width - 2);
  const body = clipToWidth(`${' '.repeat(pad)}${text}`, inner);
  return `${p.border(V_LINE)}${body}${' '.repeat(Math.max(0, inner - styledWidth(body)))}${p.border(V_LINE)}`;
}
