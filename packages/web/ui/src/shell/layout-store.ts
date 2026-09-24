/**
 * Frame measurement and column preferences, ported from deepseek-harness
 * `ui-layout/src/client/stores.ts` (MIT) with its Cordis store replaced by
 * plain pure functions — no DOM, no React, directly testable.
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
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from './columns.js';

export interface LayoutState {
  /** Sidebar width preference in px; 0 = closed to the rail. */
  sidebar: number;
  /** Last positive frame measurement; window width bootstraps the first render. */
  viewportWidth: number;
  /** Narrow-frame override: a manual toggle below the breakpoint expands the
   *  rail over the squeezed center without touching the width preference. */
  narrowExpanded: boolean;
  /** Saved right panel width in px, or null before its first opening. */
  rightbar: number | null;
  /** Whether the right panel is drawn at all, in either presentation. */
  rightbarShown: boolean;
  /** Whether the normal panel width reserves a grid track, including beneath
   *  fullscreen. Reported by the occupant; always false while hidden. */
  rightbarTrack: boolean;
  /** Reported fullscreen presentation; hides the outer resize handle. */
  rightbarFullscreen: boolean;
  /** Suppress track transitions for a fullscreen exit until another geometry
   *  action (an eased 0 → normal sweep under a fullscreen panel looks like a
   *  jump; the exit must be instant). */
  rightbarInstant: boolean;
}

/** Boot state. `viewportWidth` seeds from the window so the first paint is not
 *  a zero-width frame (the frame's own measurement lands in a layout effect). */
export function initialLayout(viewportWidth = window.innerWidth): LayoutState {
  return {
    sidebar: SIDEBAR_DEFAULT,
    viewportWidth,
    narrowExpanded: false,
    rightbar: null,
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
    sidebar: clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX),
  };
}

/** Narrow toggles flip only the override: the width preference survives
 *  untouched, so re-widening restores the pre-squeeze layout. */
export function toggleSidebar(state: LayoutState): LayoutState {
  if (state.viewportWidth < SIDEBAR_AUTO_COLLAPSE) {
    return { ...state, rightbarInstant: false, narrowExpanded: !state.narrowExpanded };
  }
  return { ...state, rightbarInstant: false, sidebar: state.sidebar === 0 ? SIDEBAR_DEFAULT : 0 };
}

/** Crossing the breakpoint in either direction drops the override: the narrow
 *  default is auto-collapsed, the wide state is the preference. */
export function setViewportWidth(state: LayoutState, width: number): LayoutState {
  if (state.viewportWidth === width) return state;
  const crossed =
    state.viewportWidth < SIDEBAR_AUTO_COLLAPSE !== width < SIDEBAR_AUTO_COLLAPSE;
  return { ...state, rightbarInstant: false, narrowExpanded: crossed ? false : state.narrowExpanded, viewportWidth: width };
}

export function setRightbar(state: LayoutState, px: number): LayoutState {
  return {
    ...state,
    rightbarInstant: false,
    rightbar: clampWidth(px, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, state.viewportWidth * RIGHTBAR_MAX_RATIO)),
  };
}

/**
 * Report the right panel's presentation. The first opening seeds the width
 * preference at 45% of the frame, and opening below the breakpoint collapses
 * the sidebar first (the panel takes the room, not the center).
 */
export function openRightbar(state: LayoutState, track: boolean, fullscreen: boolean): LayoutState {
  // Only a changed presentation rewrites the flag; a repeated report of the
  // same one leaves a pending instant-exit in place.
  const presentationChanged =
    !state.rightbarShown || state.rightbarTrack !== track || state.rightbarFullscreen !== fullscreen;
  return {
    ...state,
    rightbarInstant: presentationChanged ? state.rightbarFullscreen && !fullscreen : state.rightbarInstant,
    narrowExpanded:
      !state.rightbarShown && state.viewportWidth < SIDEBAR_AUTO_COLLAPSE ? false : state.narrowExpanded,
    rightbar:
      state.rightbar ?? Math.max(RIGHTBAR_MIN, Math.round(state.viewportWidth * RIGHTBAR_DEFAULT_RATIO)),
    rightbarShown: true,
    rightbarTrack: track,
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

/** The sidebar's rendered width preference after responsive collapse. */
export function sidebarPreference(state: LayoutState): number {
  const narrow = state.viewportWidth < SIDEBAR_AUTO_COLLAPSE;
  const collapsed = narrow ? !state.narrowExpanded : state.sidebar === 0;
  if (collapsed) return 0;
  return state.sidebar === 0 ? SIDEBAR_DEFAULT : state.sidebar;
}

/** Whether the sidebar renders as the collapsed rail. */
export function sidebarCollapsed(state: LayoutState): boolean {
  return state.viewportWidth < SIDEBAR_AUTO_COLLAPSE ? !state.narrowExpanded : state.sidebar === 0;
}