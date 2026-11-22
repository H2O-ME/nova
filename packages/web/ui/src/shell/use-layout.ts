/**
 * Frame measurement and column preferences as a React binding. All the
 * decisions live in
 * `layout-store.ts` (pure, directly tested); this module only owns the state
 * cell, the `dragging` flag the tracks read, and the stable action identities
 * `AppFrame`'s effects depend on.
 *
 * It also owns the two time-bound behaviors the pure store cannot:
 * - the auto-collapse debounce: geometry (`setViewportWidth`) lands on every
 *   frame measurement, but the COLLAPSE it causes is committed only once the
 *   window has been idle — the reference's auto-collapse runs off a resize
 *   idle timer, so dragging the window edge does not flip the rail per frame.
 *   The FIRST measurement applies immediately (a load into a narrow window
 *   must not flash the expanded column).
 * - width persistence: the stored width is written when a drag SETTLES (the
 *   dragging flag falls), not per pointer frame — the reference persists on
 *   drag finish for the same reason.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collapseFor } from './columns.js';
import type { LayoutState } from './layout-store.js';
import {
  closeRightbar as closeRightbarState,
  initialLayout,
  openRightbar as openRightbarState,
  setAutoCollapse as setAutoCollapseState,
  setConversationWidth as setConversationWidthState,
  setRightbar as setRightbarState,
  setSidebar as setSidebarState,
  setViewportWidth as setViewportWidthState,
  sidebarCollapsed,
  toggleSidebar as toggleSidebarState,
} from './layout-store.js';
import {
  persistRightbarWidth,
  persistSidebarWidth,
  readStoredRightbarWidth,
  readStoredSidebarWidth,
} from './layout-persist.js';

/** Idle time a window resize must go quiet before the auto-collapse commits. */
const RESIZE_IDLE_MS = 150;

export interface LayoutBinding {
  layout: LayoutState;
  /** True while a column drag is in flight (pauses the track transitions). */
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  setViewportWidth: (width: number) => void;
  /** Report the CONVERSATION column's measured width (drives the collapse). */
  setConversationWidth: (width: number) => void;
  setSidebar: (px: number) => void;
  setRightbar: (px: number) => void;
  openRightbar: (fullscreen: boolean) => void;
  closeRightbar: () => void;
  toggleSidebar: () => void;
  /** Whether the sidebar renders as the collapsed rail. */
  collapsed: boolean;
  /** The frame is (debounced) below the auto-collapse breakpoint. */
  narrow: boolean;
}

export function useLayout(): LayoutBinding {
  const [layout, setLayout] = useState<LayoutState>(() =>
    initialLayout(
      typeof window === 'undefined' ? 0 : window.innerWidth,
      { sidebar: readStoredSidebarWidth(), rightbar: readStoredRightbarWidth() },
    ),
  );
  const [dragging, setDragging] = useState(false);

  // The frame's first measurement is the boot truth (a load into a narrow
  // window collapses immediately); later crossings wait for resize idle.
  const firstMeasure = useRef(true);
  const idleTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
  }, []);

  const setViewportWidth = useCallback((width: number): void => {
    setLayout((state) => setViewportWidthState(state, width));
  }, []);

  /**
   * The collapse policy's one input: the conversation column's measured width.
   *
   * Measured from the reference (`WorkspaceShellLayout.tsx:912-919`), which
   * watches the conversation pane rather than the window — so this fires for
   * a dragged sidebar and a newly opened panel too, not only for a window
   * resize. The reference deliberately resizes on WINDOW resize only and skips
   * its own ResizeObserver, so a panel the reader opened is never closed again
   * by policy; Nova keeps that: `setConversationWidth` is called from the
   * frame's measurement pass, which runs when the frame resizes OR when a
   * drag settles, never per drag frame.
   *
   * The FIRST measurement applies immediately (a load into a narrow frame must
   * not flash the expanded column); later crossings wait for resize idle.
   */
  const setConversationWidth = useCallback((width: number): void => {
    // A zero-width report is NOT a narrow column: it is a measurement taken
    // before layout. Committing it would collapse the rail on every load.
    if (!(width > 0)) return;
    // Store the fact FIRST: the debounced branch below reads it back, and the
    // earlier version of this function wrote only the collapse, so a settle
    // always saw 0 and read it as "narrower than the threshold".
    setLayout((state) => setConversationWidthState(state, width));
    if (firstMeasure.current) {
      firstMeasure.current = false;
      setLayout((state) => setAutoCollapseState(state, collapseFor(state.autoNarrow, width)));
      return;
    }
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      idleTimer.current = null;
      // Read the CURRENT fact: a crossing that un-crossed inside the idle
      // window commits as a no-op.
      setLayout((state) => setAutoCollapseState(state, collapseFor(state.autoNarrow, state.conversationWidth)));
    }, RESIZE_IDLE_MS);
  }, []);

  const setSidebar = useCallback((px: number): void => {
    setLayout((state) => setSidebarState(state, px));
  }, []);
  const setRightbar = useCallback((px: number): void => {
    setLayout((state) => setRightbarState(state, px));
  }, []);
  const openRightbar = useCallback((fullscreen: boolean): void => {
    setLayout((state) => openRightbarState(state, fullscreen));
  }, []);
  const closeRightbar = useCallback((): void => {
    setLayout((state) => closeRightbarState(state));
  }, []);
  const toggleSidebar = useCallback((): void => {
    setLayout((state) => toggleSidebarState(state));
  }, []);

  // Persist on SETTLE: during a drag the widths change per pointer frame with
  // `dragging` true (skipped here); the flag falling to false is the drag's
  // end and carries the final width. A first-open seed (no drag at all) lands
  // through the same effect. Non-positive sidebar values (the rail) remove the
  // entry — closed is a presentation, not a width.
  useEffect(() => {
    if (dragging) return;
    persistSidebarWidth(layout.sidebar);
  }, [dragging, layout.sidebar]);
  useEffect(() => {
    if (dragging || layout.rightbar === null) return;
    persistRightbarWidth(layout.rightbar);
  }, [dragging, layout.rightbar]);

  return useMemo(
    () => ({
      layout,
      dragging,
      setDragging,
      setViewportWidth,
      setConversationWidth,
      setSidebar,
      setRightbar,
      openRightbar,
      closeRightbar,
      toggleSidebar,
      collapsed: sidebarCollapsed(layout),
      narrow: layout.autoNarrow,
    }),
    [layout, dragging, setViewportWidth, setConversationWidth, setSidebar, setRightbar, openRightbar, closeRightbar, toggleSidebar],
  );
}
