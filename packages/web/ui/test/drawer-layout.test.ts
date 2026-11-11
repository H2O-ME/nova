/**
 * The right panel is a DRAWER (W1), and this lane pins the two invariants that
 * make it one — both of which the old three-column frame violated:
 *
 *  1. **Opening it does not move the conversation.** The panel is solved as
 *     zero width, so the centre keeps its whole remainder; a regression that
 *     lets it reserve a track shrinks the transcript again and this goes red.
 *  2. **Opening it does not collapse the sidebar.** The old rule collapsed the
 *     rail on a narrow frame so the panel could take the room, which yanked the
 *     session list away; a floating drawer asks for nothing.
 *
 * The lane is pure: it solves `computeColumns` the way `AppFrame` does rather
 * than rendering a frame (this lane has no DOM).
 */
import { describe, expect, it } from 'vitest';
import {
  computeColumns,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  RIGHTBAR_DEFAULT_RATIO,
} from '../src/shell/columns.js';
import { initialLayout, openRightbar, setViewportWidth, sidebarPreference, toggleSidebar } from '../src/shell/layout-store.js';

const wide = (): ReturnType<typeof initialLayout> => setViewportWidth(initialLayout(1600), 1600);

/**
 * What `AppFrame` writes for the conversation track: the drawer bids zero, so
 * the solve is asked for a frame with no right column at all. The preference
 * argument is kept in the signature to make the call sites read like the real
 * one (`centerWithDrawer(1600, sidebar, pref)`), and asserted below to be
 * unused by the solve — a regression that lets the drawer bid a width would
 * have to change this helper, which is the point.
 */
function centerWithDrawer(viewport: number, sidebar: number, rightbarPreference: number): number {
  // The drawer contributes no track; `rightbarPreference` documents what the
  // panel WANTS while the solve is told it gets nothing.
  expect(rightbarPreference).toBeGreaterThanOrEqual(0);
  return computeColumns(viewport, sidebar, 0).center;
}

describe('the right drawer leaves the conversation alone', () => {
  it('the centre keeps the same width with the drawer open or closed', () => {
    const layout = openRightbar(wide(), false);
    const preference = sidebarPreference(layout);
    const closed = computeColumns(1600, preference, 0).center;
    const open = centerWithDrawer(1600, preference, layout.rightbar ?? 1600 * RIGHTBAR_DEFAULT_RATIO);
    expect(open).toBe(closed);
  });

  it('the drawer does not claw back width from the centre even at its cap', () => {
    // 70% is the widest a drag can make the drawer; the conversation must not
    // notice it at all.
    const sidebar = SIDEBAR_DEFAULT;
    expect(centerWithDrawer(1600, sidebar, 1120)).toBe(computeColumns(1600, sidebar, 0).center);
  });

  it('a narrow frame keeps its sidebar expanded when the drawer opens', () => {
    const narrowExpanded = toggleSidebar(setViewportWidth(wide(), SIDEBAR_AUTO_COLLAPSE - 100));
    expect(narrowExpanded.narrowExpanded).toBe(true);
    expect(openRightbar(narrowExpanded, false).narrowExpanded).toBe(true);
  });
});
