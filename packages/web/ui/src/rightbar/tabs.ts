/**
 * The panel's tab vocabulary and the one thing that outlives a reload.
 *
 * Ported in shape from deepseek-harness `ui-sidebar-right` (MIT): the strip is
 * a TAB STRIP over the pages the reader has OPEN (the reference's `openTabs`),
 * and while none is in front the body is that harness's guide page. Nothing is
 * remembered across reloads: a fresh page load opens on the guide — the
 * doorway a reader re-orients from — and the strip's own state carries the
 * rest of the session.
 *
 * Pure: no React, no DOM, so the rules can be asserted directly (the harness
 * keeps the same split between its store and its shell).
 */
import { RIGHTBAR_COPY } from './copy.js';

/** The pages the panel offers, in strip order. */
export type RightbarTabId = 'changes' | 'files' | 'tasks' | 'terminal';

/**
 * The guide's strip id. It is a TAB, not the absence of one — the reference
 * registers it as a page type (`contract/seed.ts`: `GUIDE_KIND = 'guide'`), the
 * strip's add control opens it by kind, and picking an entry from it replaces
 * it (`GuideBody`: `openTab(kind, { replaceTab: true })`). A pane holds at most
 * one, and it cannot be closed while it is the only tab there.
 */
export const GUIDE_TAB = 'guide';

/** Anything the strip draws: the guide, or one of the four pages. */
export type StripTabId = RightbarTabId | typeof GUIDE_TAB;
/** One tab as the strip draws it. */
export interface RightbarTab {
  id: RightbarTabId;
  label: string;
}

/**
 * The strip's contents. Order is deliberate: what the session CHANGED reads
 * first (it is the question a reader returns to most often), the workspace it
 * changed in second, then what is running in the background, and the shell last
 * — the reference's own `guide` order for the same providers.
 *
 * **文件 is the files WINDOW, not a tree index**: the tree is docked inside it
 * and a click opens the file beside the tree, in place. A separate 编辑器 page
 * split "find a file" from "read the file" across two tabs, so every open cost a
 * tab switch and the tree was gone by the time the file was on screen — the
 * reference's own rejected shape (its editor tab IS the files window,
 * `builtins/tabs.ts`). A remembered `editor` preference from that strip resolves
 * to the default page: the id is no longer a tab.
 */
export const RIGHTBAR_TABS: readonly RightbarTab[] = [
  { id: 'changes', label: RIGHTBAR_COPY['tab.changes'] },
  { id: 'files', label: RIGHTBAR_COPY['tab.files'] },
  { id: 'tasks', label: RIGHTBAR_COPY['tab.tasks'] },
  { id: 'terminal', label: RIGHTBAR_COPY['tab.terminal'] },
];

/** Whether a value is one of the panel's tab ids.
 * @param value - anything read from storage or a frame.
 * @returns true when the value names a tab this panel can draw.
 */
export function isTabId(value: unknown): value is RightbarTabId {
  return RIGHTBAR_TABS.some((tab) => tab.id === value);
}

/** Whether a value names a tab the strip can draw — the guide or one of the pages.
 * @param value - anything read from state or a click handler.
 * @returns true when the strip has a place for it.
 */
export function isStripTabId(value: unknown): value is StripTabId {
  return value === GUIDE_TAB || isTabId(value);
}
