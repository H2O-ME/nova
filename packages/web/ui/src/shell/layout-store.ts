/**
 * Frame measurement and the right panel's width preference, ported from
 * deepseek-harness `ui-layout/src/client/stores.ts` (MIT) with its sidebar half
 * removed (the session sidebar is gone; the session header carries this
 * product's chrome) and its Cordis store replaced by plain pure functions —
 * no DOM, no React, directly testable.
 *
 * Transient preferences only: responsive concessions never rewrite widths (a
 * narrowed frame re-solves `computeColumns` against the same preference, so
 * re-widening restores the pre-squeeze layout). The right panel keeps its px
 * preference across resizes and close, and its expanded/`fullscreen` state
 * belongs to its occupant, which reports it back through
 * `openRightbar`/`closeRightbar`.
 */
import {
  clampWidth,
  RIGHTBAR_DEFAULT_RATIO,
  RIGHTBAR_MAX_RATIO,
  RIGHTBAR_MIN,
} from './columns.js';

export interface LayoutState {
  /** Last positive frame measurement; window width bootstraps the first render. */
  viewportWidth: number;
  /** Saved right panel width in px, or null before its first opening. */
  rightbar: number | null;
  /** Whether the right panel is drawn at all, in either presentation. */
  rightbarShown: boolean;
  /** Whether the normal panel width reserves a grid track, including beneath
   *  fullscreen. Always true while shown (`openRightbar` reserves it for every
   *  shown panel), always false while hidden — a shown panel is a second
   *  column, never an overlay. */
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
    viewportWidth,
    rightbar: null,
    rightbarShown: false,
    rightbarTrack: false,
    rightbarFullscreen: false,
    rightbarInstant: false,
  };
}

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
 * Open the right panel. The first opening seeds the width preference at 45% of
 * the frame.
 *
 * A shown panel RESERVES its track — the centre makes room, and that is what
 * keeps the shell two real columns instead of a panel floating over the
 * conversation. The track is not a parameter: the shown panel bids for it, and
 * the frame solve owns the one case where there is nothing to bid for — a frame
 * too narrow resolves to a zero track and the occupant draws a takeover.
 * Fullscreen keeps the track beneath the covered frame, so leaving fullscreen
 * lands on the same conversation width instead of jumping.
 */
export function openRightbar(state: LayoutState, fullscreen: boolean): LayoutState {
  // Only a changed presentation rewrites the flag; a repeated report of the
  // same one leaves a pending instant-exit in place.
  const presentationChanged =
    !state.rightbarShown || !state.rightbarTrack || state.rightbarFullscreen !== fullscreen;
  return {
    ...state,
    rightbarInstant: presentationChanged ? state.rightbarFullscreen && !fullscreen : state.rightbarInstant,
    rightbar:
      state.rightbar ?? Math.max(RIGHTBAR_MIN, Math.round(state.viewportWidth * RIGHTBAR_DEFAULT_RATIO)),
    rightbarShown: true,
    rightbarTrack: true,
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
