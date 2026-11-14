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

  it('a drag clamps into the contract range', () => {
    expect(setSidebar(wide(), 100).sidebar).toBe(264);
    expect(setSidebar(wide(), 9999).sidebar).toBe(420);
  });

  it('a narrow frame auto-collapses and the manual toggle only overrides it', () => {
    const narrow = setViewportWidth(setSidebar(wide(), 400), 900);
    expect(sidebarCollapsed(narrow)).toBe(true);
    const expanded = toggleSidebar(narrow);
    expect(sidebarCollapsed(expanded)).toBe(false);
    // The override expands the rail; the width preference is untouched.
    expect(expanded.sidebar).toBe(400);
    expect(sidebarPreference(expanded)).toBe(400);
  });

  it('crossing the breakpoint in either direction drops the override', () => {
    const expanded = toggleSidebar(setViewportWidth(wide(), 900));
    expect(sidebarCollapsed(expanded)).toBe(false);
    const widened = setViewportWidth(expanded, 1400);
    expect(widened.narrowExpanded).toBe(false);
    expect(sidebarCollapsed(setViewportWidth(widened, 900))).toBe(true);
  });
});

describe('right panel preference', () => {
  it('an open panel floats as a drawer — it never reserves a track', () => {
    // W1: the panel used to reserve a grid track (`rightbarTrack: true`), which
    // squeezed the conversation into a third column beside it. It now floats
    // over the centre, so the only states are shown/hidden — never "three
    // columns". Re-introducing `rightbarTrack: true` turns this red.
    expect(openRightbar(wide(), false).rightbarTrack).toBe(false);
    // Fullscreen covers the frame; it also keeps the track flag false so a
    // restored drawer does not start reserving space.
    expect(openRightbar(wide(), true).rightbarTrack).toBe(false);
    expect(openRightbar(openRightbar(wide(), true), false).rightbarTrack).toBe(false);
    expect(closeRightbar(openRightbar(wide(), false)).rightbarTrack).toBe(false);
  });

  it('seeds at 45% of the frame on first opening and keeps its px afterwards', () => {
    const opened = openRightbar(wide(), false);
    expect(opened.rightbarShown).toBe(true);
    expect(opened.rightbar).toBe(720);
    // A frame resize re-solves the tracks but never rewrites the preference.
    expect(setViewportWidth(opened, 1200).rightbar).toBe(720);
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
    // yank the session list out from under the pointer.
    const narrowExpanded = toggleSidebar(setViewportWidth(wide(), 900));
    expect(narrowExpanded.narrowExpanded).toBe(true);
    expect(openRightbar(narrowExpanded, false).narrowExpanded).toBe(true);
  });

  it('a drag clamps into [300, 70% of the frame]', () => {
    const opened = openRightbar(wide(), false);
    expect(setRightbar(opened, 100).rightbar).toBe(300);
    expect(setRightbar(opened, 9999).rightbar).toBe(1120);
  });
});