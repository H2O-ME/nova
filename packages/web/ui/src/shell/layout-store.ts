/**
 * Frame measurement and column preferences as plain pure functions with no
 * store layer beneath — no DOM, no React, directly testable.
 *
 * Transient preferences only: responsive concessions never rewrite widths (a
 * narrowed frame re-solves `computeColumns` against the same preference, so
 * re-widening restores the pre-squeeze layout). For the sidebar the preference
 * IS the width, so closing it forgets its drag width — reopening restores the
 * contract default. The right panel keeps its px preference across resizes and
 * close, and its expanded/`fullscreen` state belongs to its occupant, which
 * reports it back through `openRightbar`/`closeRightbar`.
 */
import {
  clampWidth,
  RIGHTBAR_DEFAULT_RATIO,
  RIGHTBAR_MAX_RATIO,
  RIGHTBAR_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  sidebarMaxWidth,
} from './columns.js';

export interface LayoutState {
  /** Sidebar width preference in px; 0 = closed to the sliver. */
  sidebar: number;
  /** Last positive frame measurement; window width bootstraps the first render. */
  viewportWidth: number;
  /** Saved right panel width in px, or null before its first opening. */
  rightbar: number | null;
  /** Whether the right panel is drawn at all, in either presentation. */
  rightbarShown: boolean;
  /** Whether the normal panel width reserves a grid track. True while the panel
   *  is shown in its normal presentation (the shell is three columns), false
   *  while hidden or fullscreen. */
  rightbarTrack: boolean;
  /** Reported fullscreen presentation; hides the outer resize handle. */
  rightbarFullscreen: boolean;
  /** Suppress track transitions for a fullscreen exit until another geometry
   *  action (an eased 0 → normal sweep under a fullscreen panel looks like a
   *  jump; the exit must be instant). */
  rightbarInstant: boolean;
}

/** Widths restored from the last session (`shell/layout-persist.ts`), already
 *  validated as finite positives by the reader; clamped here against the boot
 *  viewport. */
export interface RestoredWidths {
  sidebar?: number | null;
  rightbar?: number | null;
}

/** Boot state. `viewportWidth` seeds from the window so the first paint is not
 *  a zero-width frame (the frame's own measurement lands in a layout effect);
 *  the default reads the window through a guard so a static/SSR render never
 *  crashes. Restored widths ride in already read, and are clamped against the
 *  boot viewport the way the reference clamps its stored width on read. */
export function initialLayout(
  viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth,
  restored: RestoredWidths = {},
): LayoutState {
  return {
    sidebar:
      restored.sidebar !== null && restored.sidebar !== undefined && restored.sidebar > 0
        ? clampWidth(restored.sidebar, SIDEBAR_MIN, sidebarMaxWidth(viewportWidth))
        : SIDEBAR_DEFAULT,
    viewportWidth,
    rightbar:
      restored.rightbar !== null && restored.rightbar !== undefined && restored.rightbar > 0
        ? clampWidth(restored.rightbar, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, viewportWidth * RIGHTBAR_MAX_RATIO))
        : null,
    rightbarShown: false,
    rightbarTrack: false,
    rightbarFullscreen: false,
    rightbarInstant: false,
  };
}

export function setSidebar(state: LayoutState, px: number): LayoutState {
  return {
    ...state,
    rightbarInstant: false,
    sidebar: clampWidth(px, SIDEBAR_MIN, sidebarMaxWidth(state.viewportWidth)),
  };
}

/**
 * The one toggle. Whether the toggle came from the reader or from the
 * auto-collapse policy (`shell/use-auto-collapse.ts`) makes no difference to
 * the state it writes — the reference keeps ONE `isSidebarVisible` boolean for
 * both, so a policy close is indistinguishable from a reader close and the
 * column simply stays where it was put.
 */
export function toggleSidebar(state: LayoutState): LayoutState {
  return { ...state, rightbarInstant: false, sidebar: state.sidebar === 0 ? SIDEBAR_DEFAULT : 0 };
}

/** Geometry follows the live measurement immediately. */
export function setViewportWidth(state: LayoutState, width: number): LayoutState {
  if (state.viewportWidth === width) return state;
  return { ...state, rightbarInstant: false, viewportWidth: width };
}

export function setRightbar(state: LayoutState, px: number): LayoutState {
  return {
    ...state,
    rightbarInstant: false,
    rightbar: clampWidth(px, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, state.viewportWidth * RIGHTBAR_MAX_RATIO)),
  };
}

/**
 * Open the right panel. The first opening seeds the width preference at 30% of
 * the frame.
 *
 * The panel is the THIRD COLUMN (2026-11-21, the reader's call): the reference
 * draws three panels side by side on one ground — task list, conversation, side
 * pane — and a floating drawer over the transcript did not read as that shell.
 * `rightbarTrack` therefore reserves the grid track, the centre makes room, and
 * `AppFrame` solves all three widths together (`computeColumns`). Fullscreen is
 * its own presentation and keeps the track flag false.
 */
export function openRightbar(state: LayoutState, fullscreen: boolean): LayoutState {
  // Only a changed presentation rewrites the flag; a repeated report of the
  // same one leaves a pending instant-exit in place.
  const presentationChanged = !state.rightbarShown || state.rightbarFullscreen !== fullscreen;
  return {
    ...state,
    rightbarInstant: presentationChanged ? state.rightbarFullscreen && !fullscreen : state.rightbarInstant,
    rightbar:
      state.rightbar ?? Math.max(RIGHTBAR_MIN, Math.round(state.viewportWidth * RIGHTBAR_DEFAULT_RATIO)),
    rightbarShown: true,
    // Fullscreen covers the frame; its own geometry is fixed, so it must not
    // reserve the normal track underneath (that would squeeze the centre twice).
    rightbarTrack: !fullscreen,
    rightbarFullscreen: fullscreen,
  };
}

export function closeRightbar(state: LayoutState): LayoutState {
  return {
    ...state,
    rightbarInstant: state.rightbarShown ? state.rightbarFullscreen : false,
    rightbarShown: false,
    rightbarTrack: false,
    rightbarFullscreen: false,
  };
}

/** The sidebar's rendered width preference: its measured width, or 0 closed. */
export function sidebarPreference(state: LayoutState): number {
  return state.sidebar === 0 ? 0 : state.sidebar;
}

/** Whether the sidebar renders as the closed sliver. */
export function sidebarCollapsed(state: LayoutState): boolean {
  return state.sidebar === 0;
}
