/**
 * The session list's browsing controls, pure and DOM-free: which rows a query
 * keeps, what the section is called in each grouping mode, and the persisted
 * grouping preference (the durable boundary sits at the foot, like
 * `conversation/content-width.ts`, so the logic above it stays testable).
 *
 * Copy is the deepseek-harness zh dictionary verbatim (`workspace` namespace,
 * (c) 2026 DeepSeek, MIT) — one deliberate narrowing: the reference searches
 * session history *content* through its host (`search.unavailable` is its own
 * degraded mode), and this kernel has no such index, so the search box here is
 * always in that degraded mode and says so on the row.
 */
import type { SessionListItem } from '../types.js';

/** How the list files its rows: the reference's `groupBy` axis. */
export type GroupMode = 'workspace' | 'flat';

/** Words the browsing controls render (the reference's `workspace` keys). */
export const LIST_COPY = {
  'section.workspaces': '工作区',
  'section.sessions': '会话',
  'search.sessions.aria': '搜索会话',
  'search.placeholder': '搜索会话…',
  'search.clear': '清除搜索',
  'search.scope': '仅匹配标题',
  'search.noMatches': '无匹配会话',
  'viewOptions.label': '视图选项',
  'groupBy.label': '分组方式',
  'groupBy.workspace': '按工作区',
  'groupBy.flat': '单列表',
  'empty.none': '暂无会话',
} as const;

/** localStorage key for the grouping preference. */
export const LIST_VIEW_PREF_KEY = 'nova.sidebar.listView';

/** What the section header reads in each mode (the reference's own pair). */
export function sectionLabel(mode: GroupMode): string {
  return mode === 'flat' ? LIST_COPY['section.sessions'] : LIST_COPY['section.workspaces'];
}

/**
 * The rows a query keeps: a case-insensitive substring of the row's title — the
 * only text this surface has (the log's first prompt, projected by the host).
 * An empty or whitespace-only query keeps everything, so clearing the box is
 * the way back to the full list.
 * @param items - the host's newest-first rows.
 * @param query - the raw search box contents.
 * @returns the matching rows, in the order they arrived.
 */
export function filterItems(items: readonly SessionListItem[], query: string): SessionListItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...items];
  return items.filter((item) => item.title.toLowerCase().includes(needle));
}

/**
 * The grouping preference: a corrupt or absent value resolves to the grouped
 * view rather than throwing (a browser with storage denied must still render).
 * @returns the stored mode.
 */
export function readGroupMode(): GroupMode {
  const store = durableStorage();
  if (store === null) return 'workspace';
  try {
    return store.getItem(LIST_VIEW_PREF_KEY) === 'flat' ? 'flat' : 'workspace';
  } catch {
    return 'workspace';
  }
}

/**
 * Persist a grouping choice. Best effort: a browser that refuses writes keeps
 * the choice for this page's lifetime only.
 * @param mode - the mode to remember.
 */
export function writeGroupMode(mode: GroupMode): void {
  const store = durableStorage();
  if (store === null) return;
  try {
    store.setItem(LIST_VIEW_PREF_KEY, mode);
  } catch {
    /* the choice simply does not survive the reload */
  }
}

/** The localStorage handle, or null where there is none to be had. */
function durableStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    /* some engines throw on the property access itself */
    return null;
  }
}