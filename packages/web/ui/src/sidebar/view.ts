/**
 * Sidebar view logic, pure and DOM-free: the workspace-fold keys, the
 * five-row chunk rule, the current group's auto-expand target, the connection
 * indicator's state, and the column's copy. Everything a row needs beyond its
 * own data is computed here so the vitest lane can assert it without a DOM
 * (the component lane holds no arithmetic).
 *
 * Copy is the deepseek-harness zh dictionary verbatim (`sidebar` +
 * `workspace` + `settings` namespaces, (c) 2026 DeepSeek, MIT): the sidebar
 * reads the same words as the reference column, so a screenshot comparison
 * compares geometry rather than translation.
 */
import type { SessionGroup } from '../session-groups.js';
import type { SessionListItem } from '../types.js';
import type { ConnectionIndicatorState } from './ConnectionIndicator.js';

/** Ordinary session rows one workspace shows before its local overflow control
 * (ui-workspace `COLLAPSED_SESSION_LIMIT`). */
export const COLLAPSED_SESSION_LIMIT = 5;

/** How long a healed connection keeps reading as connected before the indicator
 * retires (ui-settings-general `RECOVERY_CONFIRMATION_MS`). */
export const RECOVERY_CONFIRMATION_MS = 2_000;

/** The three states of the browser's one socket (client.ts). */
export type SocketState = 'connecting' | 'open' | 'closed';

/** Words the column renders; keys are the reference's dictionary keys. */
export const SIDEBAR_COPY = {
  /** The reference's `brand.localBuild` fallback seat: our product name. */
  brand: 'Nova',
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'section.sessions': '会话',
  'empty.none': '暂无会话',
  'list.loading': '加载中…',
  'list.reload': '刷新列表',
  'settings.label': '设置',
  'appearance.label': '外观',
  'appearance.light': '亮色',
  'appearance.dark': '暗色',
  'appearance.system': '跟随系统',
  'fontSize.label': '字号',
  'sessions.collapse': '收起',
  'sessions.expand': '展开其余 {n} 个会话',
  'connection.error': '连接异常',
  'connection.retry': '立即重连',
  'connection.connecting': '自动重连中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中断，正在自动重试，点击立即重连',
} as const;

/** `展开其余 {n} 个会话` (ui-workspace `sessions.expand`), or `收起` when open. */
export function overflowLabel(hiddenCount: number, expanded: boolean): string {
  return expanded
    ? SIDEBAR_COPY['sessions.collapse']
    : SIDEBAR_COPY['sessions.expand'].replace('{n}', String(hiddenCount));
}

/** Class-name joiner for the module classes (no clsx dependency by policy). */
export function cls(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

/**
 * A group's fold key: the workspace path, `''` for the ungrouped bucket (the
 * same key `groupByWorkspace` filed it under).
 */
export function groupKey(group: SessionGroup): string {
  return group.path ?? '';
}

/** A row's title: a log with no user prompt yet still needs a row. */
export function sessionTitle(item: SessionListItem): string {
  return item.title.length > 0 ? item.title : '（无标题）';
}

/**
 * The rows a folded workspace shows, plus what the overflow control hides.
 * The reference's rule also always keeps provisional blank rows visible; our
 * list is historical logs only, so the chunk is a plain prefix.
 */
export function foldedRows(items: readonly SessionListItem[]): {
  rows: readonly SessionListItem[];
  hiddenCount: number;
} {
  const rows = items.slice(0, COLLAPSED_SESSION_LIMIT);
  return { rows, hiddenCount: items.length - rows.length };
}

/**
 * The group that must open because it owns the current session, or undefined
 * when there is nothing to reveal. A key the user has already decided about —
 * open or closed — is left alone (the reference arms this once per key).
 */
export function autoExpandKey(
  groups: readonly SessionGroup[],
  currentFile: string,
  known: Readonly<Record<string, boolean>>,
): string | undefined {
  if (currentFile.length === 0) return undefined;
  const group = groups.find((candidate) => candidate.items.some((item) => item.file === currentFile));
  if (group === undefined) return undefined;
  const key = groupKey(group);
  return Object.hasOwn(known, key) ? undefined : key;
}

/** Add or drop one key (the reference's `toggled` for its expanded set). */
export function toggled(keys: readonly string[], key: string): readonly string[] {
  return keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key];
}

/**
 * The indicator's state: an outage or a retry is always worth showing, a
 * healthy socket only while the recovery confirmation is running (undefined
 * renders nothing).
 */
export function indicatorState(
  connection: SocketState,
  recovered: boolean,
): ConnectionIndicatorState | undefined {
  if (connection === 'closed') return 'disconnected';
  if (connection === 'connecting') return 'connecting';
  return recovered ? 'recovered' : undefined;
}