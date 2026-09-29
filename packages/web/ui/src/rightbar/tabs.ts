/**
 * The panel's tab vocabulary and the one thing that outlives a reload.
 *
 * Ported in shape from deepseek-harness `ui-sidebar-right` (MIT): a tab is a
 * named page kind, the strip lists them in a fixed order, and the panel's own
 * layout state (which page was in front) is remembered per browser rather than
 * per session — the harness keeps the whole docking tree in `localStorage` and
 * validates it before adopting it; this panel has one field to remember, so the
 * "validate before adopting" rule lives in {@link readTabPreference}.
 *
 * Pure: no React, no DOM beyond the injected storage accessors, so the rules can
 * be asserted directly (the harness keeps the same split between its store and
 * its shell).
 */
import { RIGHTBAR_COPY } from './copy.js';

/** The three pages the panel offers, in strip order. */
export type RightbarTabId = 'changes' | 'files' | 'terminal';

/** One tab as the strip draws it. */
export interface RightbarTab {
  id: RightbarTabId;
  label: string;
}

/**
 * The strip's contents. Order is deliberate: what the session CHANGED reads
 * first (it is the question a reader returns to most often), the workspace it
 * changed in second, and the shell third — the harness's own `guide` order for
 * the same three providers.
 */
export const RIGHTBAR_TABS: readonly RightbarTab[] = [
  { id: 'changes', label: RIGHTBAR_COPY['tab.changes'] },
  { id: 'files', label: RIGHTBAR_COPY['tab.files'] },
  { id: 'terminal', label: RIGHTBAR_COPY['tab.terminal'] },
];

/**
 * The tab the panel opens on: the first one.
 *
 * Named rather than written as `'changes'` at the call site, so adding a page in
 * front of the strip cannot silently change what a first-time reader sees.
 */
export const DEFAULT_TAB: RightbarTabId = 'changes';

/** Where the remembered tab lives (versioned: a future shape takes a new key). */
export const TAB_STORAGE_KEY = 'nova.rightbar.tab.v1';

/**
 * Whether a value is one of the panel's tab ids.
 * @param value - anything read from storage or a frame.
 * @returns true when the value names a tab this panel can draw.
 */
export function isTabId(value: unknown): value is RightbarTabId {
  return RIGHTBAR_TABS.some((tab) => tab.id === value);
}

/**
 * The remembered tab, or the default.
 *
 * Anything unrecognized — a stale key from an older strip, a value someone typed
 * into the devtools — resolves to {@link DEFAULT_TAB} instead of an empty body.
 * Storage failure (private mode, disabled cookies) is not an error worth
 * surfacing: the panel works fine without remembering.
 * @returns the tab to open on.
 */
export function readTabPreference(): RightbarTabId {
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return isTabId(stored) ? stored : DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB;
  }
}

/**
 * Remember the tab the reader moved to.
 * @param tab - the tab now in front.
 */
export function writeTabPreference(tab: RightbarTabId): void {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // A browser that refuses storage still gets a working panel; the preference
    // is a convenience, and losing it is not a failure the reader must see.
  }
}
