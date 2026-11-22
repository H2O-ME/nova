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
  /** Sidebar width preference in px; 0 = closed to the rail. */
  sidebar: number;
  /** Last positive frame measurement; window width bootstraps the first render. */
  viewportWidth: number;
  /**
   * Last positive CONVERSATION column measurement (0 until the frame publishes
   * its first one). This — not `viewportWidth` — is what the auto-collapse
   * policy reads: a panel can only hurt the transcript by the width it takes,
   * so a wide window with dragged-wide columns must collapse like a narrow one.
   */
  conversationWidth: number;
  /**
   * The debounced fact "this frame is narrower than the auto-collapse
   * breakpoint". Window resizes land in `viewportWidth` immediately (the
   * tracks must follow the live edge), but the COLLAPSE they cause waits for
   * the resize to go idle — the reference runs its auto-collapse off a resize
   * idle timer, not per frame, so dragging the window edge does not flip the
   * rail on every pixel. The binding (`use-layout`) owns the timer and calls
   * `setAutoCollapse` when it settles.
   */
  autoNarrow: boolean;
  /** Narrow-frame override: a manual toggle below the breakpoint expands the
   *  rail over the squeezed center without touching the width preference. */
  narrowExpanded: boolean;
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
    // Unknown until the frame publishes its first measurement. The boot
    // collapse is therefore decided by that first report, not guessed here —
    // a guess would have to re-derive the column's width from the viewport,
    // which is the second implementation this state exists to avoid.
    conversationWidth: 0,
    // Nothing is known about the frame yet, so nothing is collapsed. The
    // window starts hidden (`visible: false` in the Tauri config), which
    // reports `innerWidth` 0 for the first frames; guessing "narrow" from that
    // collapsed the rail on every launch and — because the first measurement
    // is the only other writer — never undid it. A genuinely narrow load is
    // answered one measurement later, which is the same frame the reader sees.
    autoNarrow: false,
    narrowExpanded: false,
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
 * Commit the debounced auto-collapse fact. The only writer of `autoNarrow` —
 * the resize-idle timer in `use-layout` (and the boot state) — so a crossing
 * that un-crosses inside the idle window never flips the rail at all.
 * Crossing in either direction drops the manual override: the narrow default
 * is auto-collapsed, the wide state is the preference.
 */
export function setAutoCollapse(state: LayoutState, narrow: boolean): LayoutState {
  if (state.autoNarrow === narrow) return state;
  return { ...state, rightbarInstant: false, autoNarrow: narrow, narrowExpanded: false };
}

/** Narrow toggles flip only the override: the width preference survives
 *  untouched, so re-widening restores the pre-squeeze layout. */
export function toggleSidebar(state: LayoutState): LayoutState {
  if (state.autoNarrow) {
    return { ...state, rightbarInstant: false, narrowExpanded: !state.narrowExpanded };
  }
  return { ...state, rightbarInstant: false, sidebar: state.sidebar === 0 ? SIDEBAR_DEFAULT : 0 };
}

/** Geometry follows the live measurement immediately; the collapse it may
 *  cause is `setAutoCollapse`'s debounced decision, not this update's. */
export function setViewportWidth(state: LayoutState, width: number): LayoutState {
  if (state.viewportWidth === width) return state;
  return { ...state, rightbarInstant: false, viewportWidth: width };
}

/**
 * Commit the measured conversation-column width. Written from the frame's
 * measurement pass; the COLLAPSE it may cause is still `setAutoCollapse`'s
 * debounced decision (`use-layout`), so dragging the window does not flip the
 * rail per frame.
 */
export function setConversationWidth(state: LayoutState, width: number): LayoutState {
  if (state.conversationWidth === width) return state;
  return { ...state, conversationWidth: width };
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

/** The sidebar's rendered width preference after responsive collapse. */
export function sidebarPreference(state: LayoutState): number {
  const collapsed = state.autoNarrow ? !state.narrowExpanded : state.sidebar === 0;
  if (collapsed) return 0;
  return state.sidebar === 0 ? SIDEBAR_DEFAULT : state.sidebar;
}

/** Whether the sidebar renders as the collapsed rail. */
export function sidebarCollapsed(state: LayoutState): boolean {
  return state.autoNarrow ? !state.narrowExpanded : state.sidebar === 0;
}
