/**
 * 弹窗四态的纯构建器（审批 / 模型 / 会话 / 命令面板）。
 * 壳层把 picker 状态解包成 plain 数据快照传进来；每行按列数裁剪、
 * 恒单行——弹窗行折行会把整个视口顶出屏幕，这条红线由本层负责。
 * 配色走 Palette 注入（plainPalette 下即无 ANSI 的确定字符串）。
 */

import { styledWidth } from '@nova-agent/tui';
import { clipToWidth, formatStamp, humanTokens, padDisplay, type Palette } from './ui.js';

/** 模型/会话面板的滑动窗口行数（导航与渲染共用，见 tui-mode 的按键层）。 */
export const MODEL_PICKER_WINDOW = 10;
export const SESSION_PICKER_WINDOW = 8;

/** 审批弹窗的三个选项（顺序与按键层、高亮索引一致）。 */
export const APPROVAL_OPTIONS = ['允许一次', '总是允许', '拒绝'];

const SWITCH_HINT = '↑↓ 选择 · Enter 切换 · Esc 取消';

export interface ApprovalPopupView {
  /** 已汉化的权限类别（permissionLabel(kind)）。 */
  permissionLabel: string;
  /** 已汉化的工具名（toolLabel(name)）。 */
  toolLabel: string;
  /** toolArgSummary 的原始摘要——按列裁剪是这一层的职责。 */
  argSummary: string;
  /** diff / 首行预览（工具 preview(args) 的产物）。 */
  previewLines: string[] | undefined;
  /** 高亮选项下标（0..2）。 */
  index: number;
  /**
   * True when the pending approval is execute-class: the popup names the
   * always-grant scope (per command program prefix) so the user knows what
   * "总是允许" actually remembers.
   */
  isExecuteKind?: boolean;
}

/** 审批弹窗：头部与 diff 预览都按剩余列数裁剪；y/n/a 与 1/2/3 是快捷键。 */
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
    const label = APPROVAL_OPTIONS[i] ?? '';
    lines.push(i === v.index ? `  ${p.cyan(p.bold(`❯ ${label}`))}` : `    ${p.dim(label)}`);
  }
  if (v.isExecuteKind === true) {
    lines.push(`  ${p.dim('总是允许按命令程序前缀记忆（如放行 git status 后续只放行 git …）')}`);
  }
  lines.push(`  ${p.dim('↑↓ 选择 · Enter 确认 · Esc 拒绝')}`);
  return lines;
}

/** 边框面板的公共骨架：标题行 + 内容行 + 底部提示行（横线补齐到 cols-3 内宽）。 */
function framed(p: Palette, title: string, hint: string, rows: string[], cols: number): string[] {
  const inner = cols - 3;
  return [
    `╭─ ${p.dim(title)} ${'─'.repeat(Math.max(0, inner - styledWidth(`─ ${title} `)))}╮`,
    ...rows,
    `╰${p.dim(hint)}${'─'.repeat(Math.max(0, inner - styledWidth(hint)))}╯`,
  ];
}

/** 面板内容行：选中行反色铺满整行宽（不是只反色标签）。 */
function panelRow(p: Palette, content: string, inner: number, selected: boolean): string {
  const pad = Math.max(0, inner - 2 - styledWidth(content));
  return selected ? `│ ${p.inverse(`${content}${' '.repeat(pad)}`)} │` : `│ ${p.dim(`${content}${' '.repeat(pad)}`)} │`;
}

export interface ModelPopupItem {
  name: string;
  /** models.dev 元数据的上下文窗口；未命中目录则 undefined（不显示尾标）。 */
  contextTokens: number | undefined;
}

export interface ModelPopupView {
  items: ModelPopupItem[];
  index: number;
  /** 当前生效的模型名（标"（当前）"）。 */
  current: string;
}

/** 模型目录：带边框面板，长列表在弹窗内滑动而非灌进转录区。 */
export function buildModelPopup(p: Palette, v: ModelPopupView, cols: number): string[] {
  const inner = cols - 3;
  const winSize = Math.min(MODEL_PICKER_WINDOW, v.items.length);
  const start = Math.max(0, Math.min(v.index - (MODEL_PICKER_WINDOW - 1), v.items.length - winSize));
  const rows: string[] = [];
  for (let i = 0; i < winSize; i++) {
    const idx = start + i;
    const item = v.items[idx];
    if (item === undefined) continue;
    const ctxTag = item.contextTokens !== undefined ? ` ${p.dim(`· ${humanTokens(item.contextTokens)} tok`)}` : '';
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

/** 会话切换器：与模型面板同款边框，最新若干条上滑窗、当前会话打标。 */
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
  /** filterCommands 的结果（滑窗由本层负责）。 */
  matches: { usage: string; description: string }[];
  index: number;
}

/** 命令面板：6 行滑动窗口，高亮项始终可见。 */
export function buildCommandPopup(p: Palette, v: CommandPopupView, cols: number): string[] {
  const inner = cols - 3;
  const visibleStart = Math.max(0, Math.min(v.index - 5, v.matches.length - 6));
  const visible = v.matches.slice(visibleStart, visibleStart + 6);
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
