/**
 * Workspaces this browser has opened — the workspace picker's rows.
 *
 * The host's session list knows sessions, not directories: a workspace the
 * user switched into and then started a fresh session in would leave no trace
 * to offer back. So the *browser* remembers what it has been shown, newest
 * first, bounded, and deduplicated. This mirrors the harness, whose workspace
 * controller keeps its own list rather than deriving one from sessions.
 *
 * It is durable-storage state (a reload keeps the menu useful), so a browser
 * that refuses storage simply has a one-entry menu — never an error.
 */

/** How many workspaces the menu remembers. */
export const RECENT_WORKSPACES_MAX = 8;

const KEY = 'nova.recentWorkspaces';

/** The remembered list, newest first; `[]` where storage is unavailable. */
export function readRecentWorkspaces(): readonly string[] {
  const store = durableStorage();
  if (store === null) return [];
  const raw = store.getItem(KEY);
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Corrupt storage is "nothing remembered", not a broken shell.
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}

/**
 * Record one workspace as most recent, returning the new list.
 *
 * Deduplicated by exact path (the same directory opened twice is one row) and
 * bounded: the menu is a shortlist, not a history.
 * @param dir - the workspace path just entered.
 * @param current - the list as last known, to avoid a read-modify-write race.
 * @returns the updated list, newest first.
 */
export function rememberWorkspace(dir: string, current: readonly string[]): readonly string[] {
  if (dir === '') return current;
  const next = [dir, ...current.filter((entry) => entry !== dir)].slice(0, RECENT_WORKSPACES_MAX);
  const store = durableStorage();
  if (store !== null) {
    try {
      store.setItem(KEY, JSON.stringify(next));
    } catch {
      /* the shortlist simply does not survive the reload */
    }
  }
  return next;
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
