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
import { SIDEBAR_AUTO_COLLAPSE } from './columns.js';
import type { LayoutState } from './layout-store.js';
import {
  closeRightbar as closeRightbarState,
  initialLayout,
  openRightbar as openRightbarState,
  setAutoCollapse as setAutoCollapseState,
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
    if (firstMeasure.current) {
      firstMeasure.current = false;
      setLayout((state) => setAutoCollapseState(state, width < SIDEBAR_AUTO_COLLAPSE));
      return;
    }
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      idleTimer.current = null;
      // Read the CURRENT state: crossings that un-crossed inside the idle
      // window commit as no-ops.
      setLayout((state) => setAutoCollapseState(state, state.viewportWidth < SIDEBAR_AUTO_COLLAPSE));
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
      setSidebar,
      setRightbar,
      openRightbar,
      closeRightbar,
      toggleSidebar,
      collapsed: sidebarCollapsed(layout),
      narrow: layout.autoNarrow,
    }),
    [layout, dragging, setViewportWidth, setSidebar, setRightbar, openRightbar, closeRightbar, toggleSidebar],
  );
}
