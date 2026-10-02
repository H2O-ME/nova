/**
 * Column geometry for the two-column shell, ported from deepseek-harness
 * `ui-layout/src/client/columns.ts` (MIT) with its sidebar half removed: the
 * session sidebar is gone (the session header carries this product's chrome),
 * so the only solve left is the centre against the right panel. The right
 * column shrinks, then loses its track, before the center drops below its
 * minimum.
 */

/** Resolved widths for one frame. */
export interface Columns {
  center: number;
  rightbar: number;
}

/** Center width protected while the right column is open. */
export const CENTER_MIN = 400;
/** Right column drag clamp floor. */
export const RIGHTBAR_MIN = 300;
/** Maximum normal right panel width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7;
/** First-open right panel preference as a fraction of the frame. */
export const RIGHTBAR_DEFAULT_RATIO = 0.45;

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
 * Solve the two column widths for one viewport frame.
 * @param viewport - available frame width in px.
 * @param rightbar - requested right panel width in px (0 = no track).
 * @returns actual widths after shrinking or removing the right track; only
 *   without that track may the center fall below its minimum, down to zero.
 */
export function computeColumns(viewport: number, rightbar: number): Columns {
  const available = viewport - CENTER_MIN;
  const r =
    rightbar === 0 || available < RIGHTBAR_MIN
      ? 0
      : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO));
  return { center: Math.max(0, viewport - r), rightbar: r };
}
