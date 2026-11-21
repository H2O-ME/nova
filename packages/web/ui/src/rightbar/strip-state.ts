/**
 * The strip's open-set transitions, as pure functions.
 *
 * Three rules:
 * 1. 文件 is always open and never closable — it is the panel's one page;
 * 2. a file tab is revealed, not duplicated: opening an open path focuses it;
 * 3. closing the front file tab falls back to the previous file tab, then to 文件.
 *
 * Pure: no React, no DOM, so the rules are asserted directly in the UI lane.
 */
import { FILE_TAB_PREFIX, fileTabId, type StripTabId } from './tabs.js';

/** The panel's one page. */
const FILES_TAB: StripTabId = 'files';

/** Which tabs the strip draws, and which one is in front. */
export interface StripState {
  readonly tabs: readonly StripTabId[];
  readonly front: StripTabId;
}

/** What a fresh page load sees: the directory, no document. */
export function initialStrip(): StripState {
  return { tabs: [FILES_TAB], front: FILES_TAB };
}

/**
 * Click a tab: it comes to the front, joining the strip if it was not open.
 * @param state - the strip as it stands.
 * @param tab - the tab clicked.
 * @returns the next state.
 */
export function focusTab(state: StripState, tab: StripTabId): StripState {
  return state.tabs.includes(tab)
    ? { tabs: state.tabs, front: tab }
    : { tabs: [...state.tabs, tab], front: tab };
}

/**
 * Open a file as its own tab — a path that already has a tab just comes to the
 * front (no duplicate, no second read); a new path joins the run and takes it.
 * @param state - the strip as it stands.
 * @param path - the absolute path to open.
 * @returns the next state, with the file's tab in front.
 */
export function openFileTab(state: StripState, path: string): StripState {
  return focusTab(state, fileTabId(path));
}

/**
 * Close one tab. 文件 is the floor: the strip always has its directory.
 * @param state - the strip as it stands.
 * @param tab - the tab whose × was clicked.
 * @returns the next state.
 */
export function closeTab(state: StripState, tab: StripTabId): StripState {
  if (tab === FILES_TAB || !state.tabs.includes(tab)) return state;
  const tabs = state.tabs.filter((id) => id !== tab);
  if (state.front !== tab) return { tabs, front: state.front };
  const fallback = [...tabs].reverse().find((id) => id.startsWith(FILE_TAB_PREFIX)) ?? FILES_TAB;
  return { tabs, front: fallback };
}
