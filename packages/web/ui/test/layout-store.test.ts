/**
 * Frame measurement and column preferences (harness ui-layout stores.ts port).
 * The store is pure functions over one immutable state, so the concessions —
 * which width survives a squeeze, which preference a close forgets — are
 * asserted directly instead of being inferred from a rendered frame.
 */
import { describe, expect, it } from 'vitest';
import {
  closeRightbar,
  initialLayout,
  openRightbar,
  setAutoCollapse,
  setRightbar,
  setSidebar,
  setViewportWidth,
  sidebarCollapsed,
  sidebarPreference,
  toggleSidebar,
} from '../src/shell/layout-store.js';

const wide = (): ReturnType<typeof initialLayout> => setViewportWidth(initialLayout(1600), 1600);

describe('sidebar preference', () => {
  it('closing forgets the drag width; reopening restores the contract default', () => {
    const dragged = setSidebar(wide(), 400);
    const closed = toggleSidebar(dragged);
    expect(closed.sidebar).toBe(0);
    expect(sidebarCollapsed(closed)).toBe(true);
    expect(sidebarPreference(closed)).toBe(0);
    expect(toggleSidebar(closed).sidebar).toBe(264);
  });

  it('a drag clamps into the contract range: half the frame, floored at 420', () => {
    expect(setSidebar(wide(), 100).sidebar).toBe(264);
    // 1600 * 0.5 = 800 — the ceiling follows the frame above the fixed floor.
    expect(setSidebar(wide(), 9999).sidebar).toBe(800);
    // 600 * 0.5 = 300 < 420: the fixed floor keeps the ceiling at 420.
    expect(setSidebar(setViewportWidth(wide(), 600), 9999).sidebar).toBe(420);
  });

  it('a resize alone never flips the rail; the idle commit does (resize debounce)', () => {
    // Geometry follows the live measurement immediately; the collapse waits
    // for `setAutoCollapse` (the binding's resize-idle timer).
    const resized = setViewportWidth(setSidebar(wide(), 400), 900);
    expect(sidebarCollapsed(resized)).toBe(false);
    const narrow = setAutoCollapse(resized, true);
    expect(sidebarCollapsed(narrow)).toBe(true);
    const expanded = toggleSidebar(narrow);
    expect(sidebarCollapsed(expanded)).toBe(false);
    // The override expands the rail; the width preference is untouched.
    expect(expanded.sidebar).toBe(400);
    expect(sidebarPreference(expanded)).toBe(400);
  });

  it('the idle commit crossing in either direction drops the override', () => {
    const expanded = toggleSidebar(setAutoCollapse(setViewportWidth(wide(), 900), true));
    expect(sidebarCollapsed(expanded)).toBe(false);
    const widened = setAutoCollapse(setViewportWidth(expanded, 1400), false);
    expect(widened.narrowExpanded).toBe(false);
    expect(sidebarCollapsed(setAutoCollapse(setViewportWidth(widened, 900), true))).toBe(true);
  });

  it('boot clamps a restored width against the boot viewport', () => {
    expect(initialLayout(1600, { sidebar: 9999 }).sidebar).toBe(800);
    expect(initialLayout(600, { sidebar: 9999 }).sidebar).toBe(420);
    expect(initialLayout(1600, { sidebar: 0 }).sidebar).toBe(264);
    expect(initialLayout(1600, { rightbar: 9999 }).rightbar).toBe(1120);
    expect(initialLayout(1600, { rightbar: 0 }).rightbar).toBe(null);
  });
});

describe('right panel preference', () => {
  it('an open panel reserves the third track (the shell is three columns)', () => {
    // 2026-11-21: the reader rejected the drawer — the reference draws three
    // panels side by side on one ground. The normal presentation therefore
    // reserves its grid track (the centre makes room); fullscreen covers the
    // frame and keeps the flag false, and a closed panel always frees it.
    expect(openRightbar(wide(), false).rightbarTrack).toBe(true);
    expect(openRightbar(wide(), true).rightbarTrack).toBe(false);
    expect(openRightbar(openRightbar(wide(), true), false).rightbarTrack).toBe(true);
    expect(closeRightbar(openRightbar(wide(), false)).rightbarTrack).toBe(false);
  });

  it('seeds at 30% of the frame on first opening and keeps its px afterwards', () => {
    const opened = openRightbar(wide(), false);
    expect(opened.rightbarShown).toBe(true);
    expect(opened.rightbar).toBe(480);
    // A frame resize re-solves the tracks but never rewrites the preference.
    expect(setViewportWidth(opened, 1200).rightbar).toBe(480);
    expect(closeRightbar(setViewportWidth(opened, 1200)).rightbarShown).toBe(false);
  });

  it('leaving fullscreen is instant; entering it is not', () => {
    const full = openRightbar(openRightbar(wide(), false), true);
    expect(full.rightbarInstant).toBe(false);
    const restored = openRightbar(full, false);
    expect(restored.rightbarInstant).toBe(true);
    // Repeating the same presentation keeps the flag as it was; any other
    // geometry action clears it.
    expect(openRightbar(restored, false).rightbarInstant).toBe(true);
    expect(setSidebar(restored, 300).rightbarInstant).toBe(false);
  });

  it('opening the drawer leaves the sidebar expanded', () => {
    // The drawer needs no concession from its neighbours: opening it must not
    // yank the session list out from under the pointer. (The resize reaches
    // the rail through the debounced commit, as the store now models it.)
    const narrowExpanded = toggleSidebar(setAutoCollapse(setViewportWidth(wide(), 900), true));
    expect(narrowExpanded.narrowExpanded).toBe(true);
    expect(openRightbar(narrowExpanded, false).narrowExpanded).toBe(true);
  });

  it('a drag clamps into [300, 70% of the frame]', () => {
    const opened = openRightbar(wide(), false);
    expect(setRightbar(opened, 100).rightbar).toBe(300);
    expect(setRightbar(opened, 9999).rightbar).toBe(1120);
  });
});