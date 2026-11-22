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

/** Center width protected while the normal right column is open. */
export const CENTER_MIN = 400;
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
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56;
/** Viewport width below which the sidebar auto-collapses to the rail; a manual
 *  toggle below it re-expands over the squeezed center (layout-store's
 *  `narrowExpanded`). */
export const SIDEBAR_AUTO_COLLAPSE = 1024;
/** Right column drag clamp floor. */
export const RIGHTBAR_MIN = 300;
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
  const available = viewport - s - CENTER_MIN;
  const r =
    rightbar === 0 || available < RIGHTBAR_MIN
      ? 0
      : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
