/**
 * Column geometry, value for value: the right column shrinks, then
 * loses its track, before the center drops below its minimum. The sidebar
 * never concedes here; `AppFrame` supplies its effective preference after
 * responsive collapse.
 */

/** Resolved widths for one frame. */
export interface Columns {
  sidebar: number;
  center: number;
  rightbar: number;
}

/** Right column drag clamp floor. */
export const RIGHTBAR_MIN = 300;
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264;
/**
 * FLOOR of the sidebar drag ceiling. The real ceiling follows the frame
 * (`sidebarMaxWidth`): half the viewport, but never tighter than this — the
 * reference clamps to `max(min-width, container * 0.5)` so a wide window can
 * widen the rail while a narrow one keeps the old fixed bound.
 */
export const SIDEBAR_MAX = 420;
/** Sidebar ceiling as a fraction of the frame (the reference's 0.5 ratio). */
export const SIDEBAR_MAX_RATIO = 0.5;
/** Sidebar width before any user drag (the reference's 264). */
export const SIDEBAR_DEFAULT = 264;
/**
 * The closed sidebar's track — NOT an icon rail.
 *
 * The reference does not fold its sidebar into a column of glyphs: the panel
 * collapses to a 6px sliver on Windows desktop (4px on mac/Linux, 0 in its web
 * build — `WorkspaceShellLayout.tsx:507` `collapsedSidebarWidthPx`), keeps its
 * content mounted at `opacity-0 pointer-events-none`, and leaves the way back
 * in a top-left overlay that never moves (`DesktopTopOverlay`). Nova's 56px
 * rail with five stacked icons was its own invention; it read as a second
 * layout of the column rather than as the column being closed.
 */
export const SIDEBAR_COLLAPSED = 6;
/**
 * The CONVERSATION COLUMN width under which the sidebar auto-collapses.
 *
 * Measured from the reference, and it is the reference's own criterion: its
 * `CONVERSATION_AUTO_COLLAPSE_SIDEBAR_WIDTH_PX` watches the conversation
 * pane's measured width, NOT the window (`WorkspaceShellLayout.tsx:159,
 * 912-919`). Nova used the window width (1024), which conceded far too early —
 * at a 1000px window the transcript still had room, so the column was squeezed
 * into a rail that then had nothing to gain. A panel can only hurt the
 * transcript by the width it actually takes, so the transcript states the
 * budget.
 */
export const SIDEBAR_COLLAPSE_BELOW_CONVERSATION = 420;
/**
 * The re-expand threshold, deliberately above the collapse one by MORE than
 * the width the closed column hands back.
 *
 * The measured width is the thing the collapse changes: closing the column
 * gives the transcript `SIDEBAR_DEFAULT - SIDEBAR_COLLAPSED` = 258px. A single
 * threshold therefore oscillates — "344 is narrow, collapse" immediately
 * measures 602 as "wide, expand", forever. The gap must exceed that 258, or
 * the collapse it just made reads as the reason to undo itself.
 */
export const SIDEBAR_EXPAND_ABOVE_CONVERSATION = SIDEBAR_COLLAPSE_BELOW_CONVERSATION + SIDEBAR_DEFAULT - SIDEBAR_COLLAPSED + 60;
/**
 * The width a crossing must see, given which way it is crossing.
 * @param current - whether the sidebar is currently closed.
 * @param width - the measured conversation column width.
 * @returns the collapse state the measurement implies.
 */
export function collapseFor(current: boolean, width: number): boolean {
  return current ? width < SIDEBAR_EXPAND_ABOVE_CONVERSATION : width < SIDEBAR_COLLAPSE_BELOW_CONVERSATION;
}
/**
 * The CONVERSATION COLUMN width under which the right panel closes itself
 * (the reference's `CONVERSATION_AUTO_COLLAPSE_SIDE_PANE_WIDTH_PX`, 480).
 * Same reasoning as the sidebar's, and it is why the panel is squeezed rather
 * than turned into a full-screen takeover: a panel that covers the transcript
 * costs the reader what they were reading, while a narrow one still leaves a
 * legible column beside it.
 */
export const RIGHTBAR_COLLAPSE_BELOW_CONVERSATION = 480;
/**
 * The conversation column's floor while BOTH side panels are open. Below this
 * the panels start conceding (the right one closes first). 360 is the
 * reference's own conversation `minSize` (`WorkspaceShellLayout.tsx:2782`), so
 * a transcript never shrinks past a readable measure no matter what the panels
 * ask for.
 */
export const CONVERSATION_MIN = 360;
/** Maximum normal right panel width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7;
/** First-open right panel preference as a fraction of the frame. The reference
 *  opens its side pane at roughly 28% of a 1536px window (436px); 0.30 lands on
 *  the same three-column rhythm without leaving the transcript thin. */
export const RIGHTBAR_DEFAULT_RATIO = 0.3;

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * The sidebar's drag ceiling for one frame: half the viewport, floored at the
 * fixed `SIDEBAR_MAX`. The reference's clamp (`WorkspaceShellLayout.tsx`
 * `clampWorkspaceSidebarWidth`) applies the same shape: every caller that
 * clamps a sidebar width — drag moves, keyboard resize, boot restore — passes
 * the viewport it measured so the bound tracks the live window.
 * @param viewport - available frame width in px.
 * @returns the widest the sidebar may get on this frame.
 */
export function sidebarMaxWidth(viewport: number): number {
  return viewport > 0
    ? Math.max(SIDEBAR_MAX, Math.round(viewport * SIDEBAR_MAX_RATIO))
    : SIDEBAR_MAX;
}

/**
 * Solve the three column widths for one viewport frame.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param rightbar - requested right panel width in px (0 = no track).
 * @returns actual widths after shrinking or removing the right track; only
 *   without that track may the center fall below its minimum, down to zero.
 */
export function computeColumns(viewport: number, sidebar: number, rightbar: number): Columns {
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, sidebarMaxWidth(viewport));
  // The transcript's floor is `CONVERSATION_MIN`, and the panel concedes to it
  // rather than the other way round: a panel narrower than its own minimum is
  // not a panel, so a frame that cannot seat both simply has no panel (the
  // collapse policy in `App.tsx` then closes it). The reference solves this
  // with one horizontal `ResizablePanelGroup` (conversation `minSize 360`, side
  // pane `minSize 240`); a flat grid can express the same concession as this
  // arithmetic.
  const available = viewport - s - CONVERSATION_MIN;
  const r =
    rightbar === 0 || available < RIGHTBAR_MIN
      ? 0
      : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
