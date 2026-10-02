/**
 * The 变更 page's comparison choices: how the open file's diff is drawn.
 *
 * The reference keeps these per review tab (`ui-deliverables` `ReviewTab`,
 * `actions.toggledSplit` / `toggledWrap`); this surface has no per-tab store,
 * so the browser remembers them across pages and restarts — the same shape the
 * terminal's shell choice uses (`terminal-shell.ts`). Unified and no-wrap are
 * the defaults: that is what a diff is before anyone asks otherwise, and the
 * reference ships the same two defaults.
 *
 * Pure: no React, no DOM beyond the storage accessors' try/catch (a browser
 * that refuses storage gets the defaults every time, which is correct).
 */

/** Which of the two comparison layouts the page draws. */
export type DiffLayout = 'unified' | 'split';

/** Where the remembered layout lives (versioned: a future shape takes a new key). */
export const DIFF_LAYOUT_KEY = 'nova.diff.layout.v1';

/** Where the remembered wrap choice lives. */
export const DIFF_WRAP_KEY = 'nova.diff.wrap.v1';

/**
 * The remembered layout; anything unrecognized reads as 统一.
 * @returns the stored layout, or `unified`.
 */
export function readDiffLayout(): DiffLayout {
  try {
    return window.localStorage.getItem(DIFF_LAYOUT_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

/**
 * Remember the layout the reader picked.
 * @param layout - the layout now in force.
 */
export function writeDiffLayout(layout: DiffLayout): void {
  try {
    window.localStorage.setItem(DIFF_LAYOUT_KEY, layout);
  } catch {
    // Storage refused: the choice holds for this page visit and no longer.
  }
}

/**
 * The remembered wrap choice; anything unrecognized reads as no-wrap (lines
 * pan horizontally, the reference's default).
 * @returns whether long lines wrap.
 */
export function readDiffWrap(): boolean {
  try {
    return window.localStorage.getItem(DIFF_WRAP_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Remember the wrap choice the reader picked.
 * @param wrap - whether long lines now wrap.
 */
export function writeDiffWrap(wrap: boolean): void {
  try {
    window.localStorage.setItem(DIFF_WRAP_KEY, wrap ? '1' : '0');
  } catch {
    // Same as above: a convenience, not a dependency.
  }
}
