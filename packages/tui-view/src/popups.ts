/**
 * Popup builders (approval / model / session / command). Pure row builders:
 * every row is clipped to a single display row so popups never push the
 * viewport — the shell handles keys, this module only builds.
 */

import { styledWidth } from '@nova-agent/tui';
import { clipToWidth } from './clip.js';
import { APPROVAL_OPTIONS } from './labels.js';
import { CHROME_PAD_COLS } from './layout.js';
import type { Palette } from './palette.js';
import { formatStamp, padDisplay } from './text.js';

export { APPROVAL_OPTIONS };
export { MODEL_PICKER_WINDOW, SESSION_PICKER_WINDOW } from './tokens.js';
import { COMMAND_PALETTE_ROWS, MODEL_PICKER_WINDOW, SESSION_PICKER_WINDOW } from './tokens.js';

export interface ApprovalPopupView {
  /** Localized permission kind. */
  permissionLabel: string;
  /** Localized tool name. */
  toolLabel: string;
  argSummary: string;
  /** Effect preview rows (tool preview(args) output). */
  previewLines: string[] | undefined;
  /** Highlighted option index (0..2). */
  index: number;
  /** Execute-class approvals name the always-grant scope. */
  isExecuteKind?: boolean;
  /**
   * 组件6：可交互调节的 always 授权范围（命令前 N 词）。给出时「总是允许」行
   * 自带实时预览、静态前缀说明行换成 ←/→ 提示；缺省时行为与旧弹窗一致。
   */
  alwaysScope?: { words: number; total: number; prefix: string };
  /**
   * 组件7：拒绝行的打字转追问——text 是已缓冲的拒绝理由（随 deny 回给模型），
   * focused 时行尾占位与提示行换成输入引导。
   */
  denyNote?: { text: string; focused: boolean };
}

/**
 * Approval panel — the interrupting dialog. Same rounded card as the picker
 * family (`framed` + `panelRow`): the screen speaks one border language, and a
 * bare left-aligned text block above the input card reads as loose output, not
 * as a question that needs an answer. The cursor row inverts across the whole
 * inner width (that band is what makes it a control, not a list).
 */
export function buildApprovalPopup(p: Palette, v: ApprovalPopupView, cols: number): string[] {
  const inner = popupInner(cols);
  const rows: string[] = [];
  // 卡片内宽是硬边界：整行内容（含行首那格气口）一律裁进 inner-2，
  // 否则右边框会溢出一格——卡片语言的底线是每行等宽。
  const row = (content: string, selected = false): void => {
    rows.push(panelRow(p, clipToWidth(content, inner - 2), inner, selected));
  };
  row(` ${v.toolLabel} ${v.argSummary}`);
  if (v.previewLines !== undefined) {
    for (const line of v.previewLines) row(` ${line}`);
  }
  for (let i = 0; i < APPROVAL_OPTIONS.length; i++) {
    const selected = i === v.index;
    let label = APPROVAL_OPTIONS[i]?.label ?? '';
    if (i === 1 && v.alwaysScope !== undefined) {
      const lead = ` ${selected ? '❯' : ' '} ${label} 前${v.alwaysScope.words}/${v.alwaysScope.total}词：`;
      label = `${label} 前${v.alwaysScope.words}/${v.alwaysScope.total}词：${clipToWidth(v.alwaysScope.prefix, Math.max(8, inner - 2 - styledWidth(lead)))}`;
    }
    if (i === 2 && v.denyNote !== undefined) {
      if (v.denyNote.text.length > 0) {
        label = `拒绝：${clipToWidth(v.denyNote.text, Math.max(8, inner - 4 - styledWidth(label)))}`;
      } else if (v.denyNote.focused) {
        label = '拒绝（打字补充理由）';
      }
    }
    row(` ${selected ? '❯' : ' '} ${label}`, selected);
  }
  // 键位归底部快捷键条（hint-bar）——卡片脚边只留"这条授权意味着什么"。
  const footer =
    v.alwaysScope === undefined && v.isExecuteKind === true
      ? '「总是允许」按命令程序前缀记忆（git status → git …；含 &&/;/| 整条）'
      : '';
  return framed(p, `${p.yellow('! 需要审批')} ${p.dim(`[${v.permissionLabel}]`)}`, footer, rows, cols);
}

/**
 * 弹窗卡片的内宽：与输入卡片同一对边距（左右各 `CHROME_PAD_COLS`）。
 * 屏幕只有一条左缘——弹窗从第 0 列铺到倒数第二列、输入卡却内缩 2 格，
 * 两张卡并排就像两个应用的窗口叠在一起。
 */
function popupInner(cols: number): number {
  return Math.max(20, cols - CHROME_PAD_COLS * 2) - 2;
}

const POPUP_LEAD = ' '.repeat(CHROME_PAD_COLS);

/**
 * Bordered panel skeleton: caption in the top edge · content rows · footer edge.
 *
 * 脚边只放**面板自己的内容**（审批卡放授权语义），绝不放键位——屏幕最后一行的
 * 快捷键条是唯一的键位面，弹窗里再印一遍 `↑↓ … Enter … Esc` 就是同一件事说两次，
 * 而两处一旦不一致（窄列整条丢弃 vs 弹窗照印）就只能有一边在骗人。
 */
function framed(p: Palette, title: string, hint: string, rows: string[], cols: number): string[] {
  const inner = popupInner(cols);
  return [
    `${POPUP_LEAD}${p.border('╭─')} ${title} ${p.border('─'.repeat(Math.max(0, inner - styledWidth(`─ ${title} `))))}${p.border('╮')}`,
    ...rows,
    `${POPUP_LEAD}${p.border('╰')}${p.dim(hint)}${p.border('─'.repeat(Math.max(0, inner - styledWidth(hint))))}${p.border('╯')}`,
  ];
}

/** Panel content row: the selected row inverts across the full width. */
function panelRow(p: Palette, content: string, inner: number, selected: boolean): string {
  const pad = Math.max(0, inner - 2 - styledWidth(content));
  const body = selected ? p.inverse(`${content}${' '.repeat(pad)}`) : p.dim(`${content}${' '.repeat(pad)}`);
  return `${POPUP_LEAD}${p.border('│')} ${body} ${p.border('│')}`;
}

export interface ModelPopupItem {
  name: string;
  contextTokens: number | undefined;
}

export interface ModelPopupView {
  items: ModelPopupItem[];
  index: number;
  current: string;
}

/** Model catalog: long lists scroll inside the popup. */
export function buildModelPopup(p: Palette, v: ModelPopupView, cols: number): string[] {
  const inner = popupInner(cols);
  const winSize = Math.min(MODEL_PICKER_WINDOW, v.items.length);
  const start = Math.max(0, Math.min(v.index - (MODEL_PICKER_WINDOW - 1), v.items.length - winSize));
  const rows: string[] = [];
  for (let i = 0; i < winSize; i++) {
    const idx = start + i;
    const item = v.items[idx];
    if (item === undefined) continue;
    const ctxTag = item.contextTokens !== undefined ? ` ${p.dim(`· ${humanTok(item.contextTokens)} tok`)}` : '';
    const content = ` ${idx === v.index ? '❯' : ' '} ${idx + 1}. ${item.name}${item.name === v.current ? '（当前）' : ''}${ctxTag}`;
    rows.push(panelRow(p, content, inner, idx === v.index));
  }
  return framed(p, '模型', '', rows, cols);
}

export interface SessionPopupItem {
  mtime: number;
  title: string;
  isCurrent: boolean;
}

export interface SessionPopupView {
  items: SessionPopupItem[];
  index: number;
}

/** Session switcher: same bordered style, current session marked. */
export function buildSessionPopup(p: Palette, v: SessionPopupView, cols: number): string[] {
  const inner = popupInner(cols);
  const winSize = Math.min(SESSION_PICKER_WINDOW, v.items.length);
  const start = Math.max(0, Math.min(v.index - (SESSION_PICKER_WINDOW - 1), v.items.length - winSize));
  const rows: string[] = [];
  for (let i = 0; i < winSize; i++) {
    const idx = start + i;
    const entry = v.items[idx];
    if (entry === undefined) continue;
    const marker = ` ${idx === v.index ? '❯' : ' '} `;
    const num = `${idx + 1}. `;
    const stamp = formatStamp(entry.mtime);
    const suffix = entry.isCurrent ? '（当前）' : '';
    const maxTitle = Math.max(0, inner - 2 - styledWidth(marker) - styledWidth(num) - styledWidth(stamp) - 1 - styledWidth(suffix));
    const content = `${marker}${num}${stamp} ${clipToWidth(entry.title, maxTitle)}${suffix}`;
    rows.push(panelRow(p, content, inner, idx === v.index));
  }
  return framed(p, '会话', '', rows, cols);
}

export interface CommandPopupView {
  matches: { usage: string; description: string }[];
  index: number;
}


/** Command palette: 6-row sliding window, cursor always visible. */
export function buildCommandPopup(p: Palette, v: CommandPopupView, cols: number): string[] {
  const inner = popupInner(cols);
  // The index can drift past the list when typing shrinks the matches — clamp
  // so the highlight (and the window math below) always lands on a real row.
  const index = Math.min(v.index, v.matches.length - 1);
  const visibleStart = Math.max(0, Math.min(index - 5, v.matches.length - COMMAND_PALETTE_ROWS));
  const visible = v.matches.slice(visibleStart, visibleStart + COMMAND_PALETTE_ROWS);
  const rows: string[] = [];
  for (let i = 0; i < visible.length; i++) {
    const spec = visible[i];
    if (spec === undefined) continue;
    const label = padDisplay(spec.usage, 22);
    const content = ` ${label} ${spec.description}`;
    rows.push(panelRow(p, content, inner, visibleStart + i === index));
  }
  return framed(p, '命令', '', rows, cols);
}

function humanTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
