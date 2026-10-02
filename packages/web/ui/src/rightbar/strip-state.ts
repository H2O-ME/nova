/**
 * The strip's open-set transitions — the reference's tab rules, as pure functions.
 *
 * Four rules, each lifted from `dsh ui-sidebar-right` and each one a red test if
 * inverted:
 * 1. the start page is a TAB (`GUIDE_KIND`), not the absence of one;
 * 2. a pane holds at most one (`canAddTab` hides the `+` while it is open);
 * 3. picking an entry REPLACES it (`openTab(kind, { replaceTab: true })`);
 * 4. it cannot be closed while it is the only tab there (`canCloseTab`).
 *
 * Remembering the last page is this panel's own addition — one localStorage
 * field where the reference keeps a whole docking tree.
 *
 * Pure: no React, no DOM (the storage read is `tabs.ts`'s job), so the four
 * rules are asserted directly in the UI lane.
 */
import { GUIDE_TAB, fileTabId, type RightbarTabId, type StripTabId } from './tabs.js';

/** Which tabs the strip draws, and which one is in front. */
export interface StripState {
  readonly tabs: readonly StripTabId[];
  readonly front: StripTabId;
}

/**
 * What a fresh page load sees: the doorway, and nothing else.
 *
 * The panel used to open on the last page the reader visited, which read as a
 * guessing game — a reload into 变更 with no session open answers a question
 * nobody asked. The guide is the panel's re-orientation point: from here every
 * page is one click, and the strip's own state carries the session the rest of
 * the way. (The reference behaves the same way per pane: its remembered docking
 * tree lives in the HOST's per-session store, not in a fresh browser.)
 * @returns the strip to boot with.
 */
export function initialStrip(): StripState {
  return { tabs: [GUIDE_TAB], front: GUIDE_TAB };
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
 * The strip's `+`: open the start page — unless this pane already holds one,
 * in which case the control would be a no-op (and is not drawn at all).
 * @param state - the strip as it stands.
 * @returns the next state.
 */
export function addGuide(state: StripState): StripState {
  return state.tabs.includes(GUIDE_TAB) ? state : focusTab(state, GUIDE_TAB);
}

/**
 * Pick an entry from the start page: that tab BECOMES the page.
 * @param state - the strip as it stands (holding the guide).
 * @param page - the entry chosen.
 * @returns the next state, with the guide gone and the page in front.
 */
export function pickGuideEntry(state: StripState, page: RightbarTabId): StripState {
  const rest = state.tabs.filter((id) => id !== GUIDE_TAB && id !== page);
  return { tabs: [...rest, page], front: page };
}

/**
 * Open a file as its own tab — the reference's reveal-if-opened: a path that
 * already has a tab just comes to the front (no duplicate, no second read);
 * a new path joins the run and takes it. One path is one tab for the panel's
 * whole life, exactly as a document tab is in the reference.
 * @param state - the strip as it stands.
 * @param path - the absolute path to open.
 * @returns the next state, with the file's tab in front.
 */
export function openFileTab(state: StripState, path: string): StripState {
  return focusTab(state, fileTabId(path));
}

/**
 * Close one tab.
 *
 * The guide standing alone is not closable (rule 4), and an emptied strip is
 * impossible: the last page's close leaves the guide, which is how the panel is
 * emptied without a strip that has nothing to draw.
 * @param state - the strip as it stands.
 * @param tab - the tab whose × was clicked.
 * @returns the next state.
 */
export function closeTab(state: StripState, tab: StripTabId): StripState {
  if (tab === GUIDE_TAB && state.tabs.length === 1) return state;
  const tabs = state.tabs.filter((id) => id !== tab);
  if (tabs.length === 0) return { tabs: [GUIDE_TAB], front: GUIDE_TAB };
  if (state.front !== tab) return { tabs, front: state.front };
  return { tabs, front: tabs[tabs.length - 1] ?? GUIDE_TAB };
}
