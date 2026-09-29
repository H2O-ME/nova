/**
 * Sidebar view logic, pure and DOM-free: the workspace-fold keys, the
 * five-row chunk rule, the current group's auto-expand target, the connection
 * indicator's state, and the column's copy. Everything a row needs beyond its
 * own data is computed here so the vitest lane can assert it without a DOM
 * (the component lane holds no arithmetic).
 *
 * Copy is the deepseek-harness zh dictionary verbatim (`sidebar` +
 * `workspace` namespaces, (c) 2026 DeepSeek, MIT): the sidebar reads the same
 * words as the reference column, so a screenshot comparison compares geometry
 * rather than translation. The settings panel's rows carry their own table
 * (`settings/copy.ts`).
 */
import type { SessionGroup } from '../session-groups.js';
import type { SessionListItem } from '../types.js';
import { LIST_COPY, filterItems } from './list-view.js';
import type { ConnectionIndicatorState } from './ConnectionIndicator.js';

/** Ordinary session rows one workspace shows before its local overflow control
 * (ui-workspace `COLLAPSED_SESSION_LIMIT`). */
export const COLLAPSED_SESSION_LIMIT = 5;

/** How long a healed connection keeps reading as connected before the indicator
 * retires (ui-settings-general `RECOVERY_CONFIRMATION_MS`). */
export const RECOVERY_CONFIRMATION_MS = 2_000;

/** Minimum time the connecting pill stays up once shown; a retry that lands
 * faster than this would otherwise flash it for a frame
 * (ui-settings-general `CONNECTING_MIN_VISIBLE_MS`). */
export const CONNECTING_MIN_VISIBLE_MS = 800;

/** The three states of the browser's one socket (client.ts). */
export type SocketState = 'connecting' | 'open' | 'closed';

/** Words the column renders; keys are the reference's dictionary keys. */
export const SIDEBAR_COPY = {
  /** The reference's `brand.localBuild` fallback seat: our product name. */
  brand: 'Nova',
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  /**
   * The NARROW-FRAME auto-collapse. Its own words because the two rails look
   * identical while meaning different things: this one is a state the WINDOW
   * imposed, so the control has to say what happened and not just what it does.
   */
  'toggle.openAuto': '窗口较窄，侧边栏已自动收起 · 点击展开',
  'toggle.collapse': '收起侧边栏',
  'section.sessions': '会话',
  'empty.none': '暂无会话',
  'list.loading': '加载中…',
  'list.reload': '刷新列表',
  'settings.label': '设置',
  'sessions.collapse': '收起',
  'sessions.expand': '展开其余 {n} 个会话',
  /* A session row's trailing stamp (the reference's `time.*` buckets, used by
     `relative-time.ts`). `time.ago` belongs to the hover card, which this
     surface does not render. */
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
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

/** A row's title: a log with no user prompt yet still needs a row — the same
 * word a brand-new session carries in the reference column. */
export function sessionTitle(item: SessionListItem): string {
  return item.title.length > 0 ? item.title : SIDEBAR_COPY['session.new'];
}

/**
 * The rows a folded workspace shows, plus what the overflow control hides.
 * The reference's rule also always keeps provisional blank rows visible; our
 * list is historical logs only, so the chunk is a plain prefix.
 * @param items - the group's sessions, newest first.
 * @param limit - how many to show; the reveal control steps this in chunks.
 * @returns the rows to draw and the count the control hides.
 */
export function foldedRows(items: readonly SessionListItem[], limit = COLLAPSED_SESSION_LIMIT): {
  rows: readonly SessionListItem[];
  hiddenCount: number;
} {
  const rows = items.slice(0, limit);
  return { rows, hiddenCount: items.length - rows.length };
}

/**
 * The next reveal limit for one group, following the reference's step.
 *
 * Three rules, and the middle one is why this is a function rather than a
 * `+ LIMIT`: an open group FOLDS, and the others grow by one chunk — except
 * when a single chunk would already cover the rest, which opens it fully. That
 * is what makes the last click land on `收起` instead of leaving a second
 * overflow row holding two sessions.
 * @param current - the group's limit, or undefined before the first click.
 * @param hiddenCount - what the current limit still hides.
 * @param expanded - whether the group is currently showing everything.
 * @returns the next limit.
 */
export function nextSessionLimit(current: number | undefined, hiddenCount: number, expanded: boolean): number {
  if (expanded) return COLLAPSED_SESSION_LIMIT;
  if (hiddenCount <= COLLAPSED_SESSION_LIMIT) return Number.POSITIVE_INFINITY;
  return (current ?? COLLAPSED_SESSION_LIMIT) + COLLAPSED_SESSION_LIMIT;
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

/**
 * One rendered row of the browsing region.
 *
 * The list is a tree rather than flat JSX because the animation diffs DOM ORDER
 * of `data-row-key`, and a nested tree would otherwise make that order implicit
 * in the markup. Expressed as data, the region renders it and the animation
 * keys off it from the SAME value — so the two cannot describe different lists
 * (which would animate rows that are not on screen).
 */
export type SidebarRow =
  | { kind: 'message'; key: string; text: string; note: boolean }
  | { kind: 'group'; key: string; group: SessionGroup; expanded: boolean; containsCurrent: boolean; hiddenCount: number; sessionsExpanded: boolean; children: SidebarRow[] }
  | { kind: 'session'; key: string; item: SessionListItem };

/**
 * The rows to render, in DOM order, for the current list state.
 *
 * Precedence follows the region: a load in flight shows only its placeholder, a
 * query replaces the tree with flat matches, and otherwise the tree renders in
 * whichever mode the view options asked for.
 * @param input - the list, the mode, the query, and the folds decided so far.
 * @returns the top-level rows, each group carrying its own session rows.
 */
export function sidebarRows(input: {
  items: readonly SessionListItem[] | null;
  groups: readonly SessionGroup[];
  mode: 'flat' | 'workspace';
  query: string;
  searching: boolean;
  expansion: Readonly<Record<string, boolean>>;
  /**
   * Per-group reveal limits, keyed like `expansion`. Absent means the collapsed
   * chunk; `Infinity` means the group is fully open. A NUMBER rather than a
   * boolean because the control steps by one chunk per click (see
   * {@link nextSessionLimit}) — a 200-session workspace must not jump from 5
   * rows to 200 in one press.
   */
  sessionLimits: Readonly<Record<string, number>>;
  currentFile: string;
}): SidebarRow[] {
  const { items, groups, mode, searching, expansion, sessionLimits, currentFile } = input;
  if (items === null) {
    return [{ kind: 'message', key: 'loading', text: SIDEBAR_COPY['list.loading'], note: false }];
  }
  if (searching) {
    // The search is a different list, not a filtered tree: it replaces the
    // grouping so matches from every workspace sit in one run.
    const matches = filterItems(items, input.query);
    if (matches.length === 0) return [{ kind: 'message', key: 'no-matches', text: LIST_COPY['search.noMatches'], note: false }];
    return [
      // The scope note names what the search actually covers (titles only:
      // this kernel keeps no content index), which is the reference's own
      // degraded mode and must not read as a full-text search.
      { kind: 'message', key: 'search-note', text: LIST_COPY['search.scope'], note: true },
      ...matches.map((item): SidebarRow => ({ kind: 'session', key: item.file, item })),
    ];
  }
  if (mode === 'flat') {
    if (items.length === 0) return [{ kind: 'message', key: 'empty', text: SIDEBAR_COPY['empty.none'], note: false }];
    return items.map((item): SidebarRow => ({ kind: 'session', key: item.file, item }));
  }
  if (groups.length === 0) return [{ kind: 'message', key: 'empty', text: SIDEBAR_COPY['empty.none'], note: false }];
  return groups.map((group): SidebarRow => {
    const key = groupKey(group);
    const expanded = expansion[key] === true;
    const limit = sessionLimits[key] ?? COLLAPSED_SESSION_LIMIT;
    // Two counts, and they answer different questions (the reference keeps the
    // same pair): `collapsed` decides whether there is a control AT ALL — a
    // group holding more than one chunk must keep the way back once it is fully
    // open — while `visible` says what that control would do next.
    const collapsed = foldedRows(group.items);
    const visible = foldedRows(group.items, limit);
    // "Fully open" is derived, not stored: the group is open exactly when its
    // limit leaves nothing hidden, so the two cannot drift apart.
    const sessionsExpanded = visible.hiddenCount === 0;
    const containsCurrent = currentFile.length > 0
      && group.items.some((item) => item.file === currentFile);
    const children: SidebarRow[] = [];
    if (expanded) {
      for (const item of (sessionsExpanded ? group.items : visible.rows)) {
        children.push({ kind: 'session', key: item.file, item });
      }
      if (collapsed.hiddenCount > 0) {
        // The overflow control is a row like any other: it moves when a group
        // expands, so it takes part in the animation rather than jumping.
        children.push({
          kind: 'message',
          key: `overflow:${key}`,
          text: overflowLabel(visible.hiddenCount, sessionsExpanded),
          note: false,
        });
      }
    }
    return {
      kind: 'group',
      key: `group:${key}`,
      group,
      expanded,
      sessionsExpanded,
      containsCurrent,
      hiddenCount: collapsed.hiddenCount,
      children,
    };
  });
}

/**
 * Every key in a rendered row tree, in DOM order (depth first, matching how the
 * markup nests). This is the array `AnimatedRows` diffs.
 * @param rows - the tree from {@link sidebarRows}.
 * @returns the keys, top to bottom.
 */
export function rowKeysOf(rows: readonly SidebarRow[]): string[] {
  const keys: string[] = [];
  const walk = (list: readonly SidebarRow[]): void => {
    for (const row of list) {
      keys.push(row.key);
      if (row.kind === 'group') walk(row.children);
    }
  };
  walk(rows);
  return keys;
}

/**
 * The indicator's state: an outage or a retry is always worth showing, a
 * healthy socket only while the recovery confirmation is running (undefined
 * renders nothing).
 *
 * `holdConnecting` is the reference's minimum-visible rule: a retry that
 * succeeds in 40ms would otherwise flash the connecting pill for one frame,
 * which reads as a glitch rather than as progress. While the hold is running it
 * wins over `recovered`, so the pill finishes its sentence before the
 * confirmation replaces it (the reference orders the same three branches).
 * @param connection - the socket's state.
 * @param recovered - the recovery confirmation window is running.
 * @param holdConnecting - the connecting pill's minimum-visible hold is running.
 * @returns the state to render, or undefined for nothing.
 */
export function indicatorState(
  connection: SocketState,
  recovered: boolean,
  holdConnecting = false,
): ConnectionIndicatorState | undefined {
  if (connection === 'connecting' || holdConnecting) return 'connecting';
  if (connection === 'closed') return 'disconnected';
  return recovered ? 'recovered' : undefined;
}

/**
 * What the indicator should be showing, and whether it is on its way out.
 *
 * The badge fades rather than vanishing: when the target state becomes
 * `undefined` the last rendered state stays on screen for the exit transition,
 * and only then is dropped. Written as a pure step so the rule can be asserted
 * without a DOM — the component only schedules the timer that feeds `undefined`
 * back in afterwards.
 * @param rendered - the state currently on screen, or undefined for nothing.
 * @param target - the state the connection now calls for, or undefined for none.
 * @returns the state to draw, and whether it is fading out.
 */
export function indicatorTransition(
  rendered: ConnectionIndicatorState | undefined,
  target: ConnectionIndicatorState | undefined,
): { rendered: ConnectionIndicatorState | undefined; leaving: boolean } {
  // Coming back is immediate: a new outage must not wait for a stale fade.
  if (target !== undefined) return { rendered: target, leaving: false };
  if (rendered === undefined) return { rendered: undefined, leaving: false };
  return { rendered, leaving: true };
}