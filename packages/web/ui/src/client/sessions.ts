/**
 * The sessions domain: the sidebar's session LIST as a state slice — when the
 * list is asked for, how its answer lands, and how the current session's title
 * updates in place. The rules are small but they are rules (single-flight,
 * stale marking, row-scoped titles), and this is their one home.
 */
import type { UiState } from '../state.js';
import type { SessionListItem } from '../types.js';

/**
 * The `sessions` frame's answer: the list replaces whatever is on screen and
 * settles both flags (the answer is the only thing that can).
 */
export function sessionListAnswered(state: UiState, items: readonly SessionListItem[]): UiState {
  return { ...state, sessions: items, sessionsStale: false, sessionsPending: false };
}

/**
 * A `list_sessions` request went out: the stale mark is cleared (the answer on
 * its way IS the refresh) and the single-flight flag is set — the list stays on
 * screen until the answer lands.
 */
export function sessionListRequested(state: UiState): UiState {
  return { ...state, sessionsStale: false, sessionsPending: true };
}

/**
 * `session_titled`: the sidebar row for THIS session updates in place; other
 * rows' titles come from disk on the next re-list. A missing row (list not
 * loaded, or the current blank filtered out) is left alone — the next
 * `sessions` answer carries the title from the durable marker anyway.
 */
export function applySessionTitle(state: UiState, title: string): UiState {
  const file = state.meta?.sessionFile;
  if (state.sessions === null || file === undefined) return state;
  return {
    ...state,
    sessions: state.sessions.map((row) =>
      row.file === file ? { ...row, title } : row,
    ),
  };
}
