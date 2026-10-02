/**
 * The trend plot's drawn geometry and its VISIBLE window: where the columns
 * sit, which of them the reader is looking at, and how tall the tallest of
 * them is.
 *
 * Split from `trend-model.ts` because it answers a different question — not
 * "what did the whole log look like", but "what is on screen right now" — and
 * because it is the one place that must know the plot's DRAWN geometry (the
 * sheet and this file are two halves of one contract). The 自适应 switch reads
 * it through `use-visible-max.ts`; the tooltip anchor reads the same constants,
 * so the bubble and the rescale can never disagree about where column `i` is.
 */
import type { ContextPoint } from '../types.js';

/**
 * The drawn column width in px (`.trendBar`), the gap between columns
 * (`.chart`'s flex gap) and the plot's left padding (`.chart`'s). The sheet and
 * this file must agree: the walk below counts columns, it does not measure them.
 */
export const BAR_WIDTH = 14;
export const BAR_GAP = 2;
export const PLOT_PAD = 2;
/** The column pitch: where column `i` starts is `PLOT_PAD + i * BAR_PITCH`. */
export const BAR_PITCH = BAR_WIDTH + BAR_GAP;

/**
 * The tallest bar inside the plot's viewport — the 自适应 toggle's reading.
 *
 * Columns sit on a fixed pitch (unlike a stretched chart), so the walk skips
 * straight to the first column whose box can still reach the window and stops
 * at the first one past the right edge. A partially visible column counts — it
 * is what the reader is looking at — and the per-column test (dsh's own) is
 * what actually decides visibility, so the arithmetic bounds only have to be
 * generous, never exact.
 * @param points - the chart's requests, oldest first (the same array the bars draw).
 * @param scrollLeft - the scroller's offset from the content start, px.
 * @param clientWidth - the scroller's visible width, px.
 * @returns the visible peak in tokens; 0 when the window holds no column
 * (an empty log, or a viewport past the last bar).
 */
export function visibleMax(points: readonly ContextPoint[], scrollLeft: number, clientWidth: number): number {
  const right = scrollLeft + clientWidth;
  const first = Math.max(0, Math.floor((scrollLeft - PLOT_PAD - BAR_WIDTH) / BAR_PITCH) + 1);
  let top = 0;
  for (let index = first; index < points.length; index += 1) {
    const start = PLOT_PAD + index * BAR_PITCH;
    if (start >= right) break;
    if (start + BAR_WIDTH <= scrollLeft) continue;
    const total = points[index]?.total ?? 0;
    if (total > top) top = total;
  }
  return top;
}
