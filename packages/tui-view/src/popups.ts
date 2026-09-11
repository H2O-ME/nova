/**
 * Popup builders (approval / model / session / command). Pure row builders:
 * every row is clipped to a single display row so popups never push the
 * viewport — the shell handles keys, this module only builds.
 */

import { styledWidth } from '@nova-agent/tui';
import { clipToWidth } from './clip.js';
import { APPROVAL_OPTIONS } from './labels.js';
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
}

/** Approval popup: header + preview clip to remaining columns. */
export function buildApprovalPopup(p: Palette, v: ApprovalPopupView, cols: number): string[] {
  const headPlain = `  ! 需要审批 [${v.permissionLabel}] ${v.toolLabel} `;
  const summary = clipToWidth(v.argSummary, Math.max(12, cols - 1 - styledWidth(headPlain)));
  const lines: string[] = [
    `  ${p.yellow(p.bold('! 需要审批'))} ${p.dim(`[${v.permissionLabel}]`)} ${v.toolLabel} ${p.dim(summary)}`,
  ];
  if (v.previewLines !== undefined) {
    for (const line of v.previewLines) lines.push(`  ${p.dim(clipToWidth(line, Math.max(12, cols - 3)))}`);
  }
  for (let i = 0; i < APPROVAL_OPTIONS.length; i++) {
    const label = APPROVAL_OPTIONS[i]?.label ?? '';
    lines.push(i === v.index ? `  ${p.cyan(p.bold(`❯ ${label}`))}` : `    ${p.dim(label)}`);
  }
  if (v.isExecuteKind === true) {
    lines.push(`  ${p.dim('总是允许按命令程序前缀记忆（如放行 git status 后续只放行 git …）')}`);
  }
  lines.push(`  ${p.dim('↑↓ 选择 · Enter 确认 · Esc 拒绝')}`);
  return lines;
}

/** Bordered panel skeleton: title row + content + hint footer. */
function framed(p: Palette, title: string, hint: string, rows: string[], cols: number): string[] {
  const inner = cols - 3;
  return [
    `╭─ ${p.dim(title)} ${'─'.repeat(Math.max(0, inner - styledWidth(`─ ${title} `)))}╮`,
    ...rows,
    `╰${p.dim(hint)}${'─'.repeat(Math.max(0, inner - styledWidth(hint)))}╯`,
  ];
}

/** Panel content row: the selected row inverts across the full width. */
function panelRow(p: Palette, content: string, inner: number, selected: boolean): string {
  const pad = Math.max(0, inner - 2 - styledWidth(content));
  return selected ? `│ ${p.inverse(`${content}${' '.repeat(pad)}`)} │` : `│ ${p.dim(`${content}${' '.repeat(pad)}`)} │`;
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
  const inner = cols - 3;
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
  return framed(p, '模型', SWITCH_HINT, rows, cols);
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
  const inner = cols - 3;
  const winSize = Math.min(SESSION_PICKER_WINDOW, v.items.length);
  const start = Math.max(0, Math.min(v.index - (SESSION_PICKER_WINDOW - 1), v.items.length - winSize));
  const rows: string[] = [];
  for (let i = 0; i < winSize; i++) {
    const idx = start + i;
    const entry = v.items[idx];
    if (entry === undefined) continue;
    const marker = ` ${idx === v.index ? '❯' : ' '} `;
    const stamp = formatStamp(entry.mtime);
    const suffix = entry.isCurrent ? '（当前）' : '';
    const maxTitle = Math.max(0, inner - 2 - styledWidth(marker) - styledWidth(stamp) - 1 - styledWidth(suffix));
    const content = `${marker}${stamp} ${clipToWidth(entry.title, maxTitle)}${suffix}`;
    rows.push(panelRow(p, content, inner, idx === v.index));
  }
  return framed(p, '会话', SWITCH_HINT, rows, cols);
}

export interface CommandPopupView {
  matches: { usage: string; description: string }[];
  index: number;
}

const SWITCH_HINT = '↑↓ 选择 · Enter 切换 · Esc 取消';

/** Command palette: 6-row sliding window, cursor always visible. */
export function buildCommandPopup(p: Palette, v: CommandPopupView, cols: number): string[] {
  const inner = cols - 3;
  const visibleStart = Math.max(0, Math.min(v.index - 5, v.matches.length - COMMAND_PALETTE_ROWS));
  const visible = v.matches.slice(visibleStart, visibleStart + COMMAND_PALETTE_ROWS);
  const rows: string[] = [];
  for (let i = 0; i < visible.length; i++) {
    const spec = visible[i];
    if (spec === undefined) continue;
    const label = padDisplay(spec.usage, 22);
    const content = ` ${label} ${spec.description}`;
    rows.push(panelRow(p, content, inner, visibleStart + i === v.index));
  }
  return framed(p, '命令', '↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭', rows, cols);
}

function humanTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
