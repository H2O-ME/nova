/**
 * Session-list grouping (pure, DOM-free, directly tested): the sessions dir is
 * GLOBAL — every project's logs land in the same date buckets — so the one
 * thing that tells two workspaces' sessions apart is the workspace each log
 * recorded at creation. Rows arrive newest-first; groups keep that order (the
 * group holding the newest row comes first) and rows stay newest-first inside
 * their group, so "the session I just had" is always the top row.
 */
import type { SessionListItem } from './types.js';

/** The group a session without a recorded workspace falls into (the harness
 * `ui-workspace` dictionary word for the same bucket). */
export const NO_WORKSPACE_LABEL = '未分组';

export interface SessionGroup {
  /** Row label: the workspace's last path segment, or `NO_WORKSPACE_LABEL`. */
  label: string;
  /** Full workspace path, for the group header's tooltip; undefined in the fallback group. */
  path: string | undefined;
  items: SessionListItem[];
}

/**
 * `D:\web\agent` / `/home/me/web/agent/` → `agent`. Both separators are
 * honoured on purpose: the sessions dir is global, so a log written on another
 * platform carries that platform's separator.
 */
export function workspaceLabel(workspace: string): string {
  const trimmed = workspace.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? trimmed;
}

/** Group the newest-first session list by workspace, preserving row order. */
export function groupByWorkspace(items: readonly SessionListItem[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  const byKey = new Map<string, SessionGroup>();
  for (const item of items) {
    const key = item.workspace ?? '';
    let group = byKey.get(key);
    if (group === undefined) {
      group = {
        label: item.workspace === undefined ? NO_WORKSPACE_LABEL : workspaceLabel(item.workspace),
        path: item.workspace,
        items: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
