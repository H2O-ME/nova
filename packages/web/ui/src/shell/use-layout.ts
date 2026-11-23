/**
 * Frame measurement and column preferences as a React binding. All the
 * decisions live in `layout-store.ts` (pure, directly tested); this module only
 * owns the state cell, the `dragging` flag the tracks read, and the stable
 * action identities `AppFrame`'s effects depend on.
 *
 * Width persistence is the one time-bound behavior here: the stored width is
 * written when a drag SETTLES (the dragging flag falls), not per pointer frame
 * — the reference persists on drag finish for the same reason.
 *
 * The responsive auto-collapse does NOT live here: it reacts to WINDOW resizes
 * only, reads the conversation column from the DOM, and sometimes has to close
 * the right panel (whose open state belongs to the shell), so it is its own
 * hook — `shell/use-auto-collapse.ts`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayoutState } from './layout-store.js';
import {
  closeRightbar as closeRightbarState,
  initialLayout,
  openRightbar as openRightbarState,
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
  /** Whether the sidebar renders as the closed sliver. */
  collapsed: boolean;
}

export function useLayout(): LayoutBinding {
  const [layout, setLayout] = useState<LayoutState>(() =>
    initialLayout(
      typeof window === 'undefined' ? 0 : window.innerWidth,
      { sidebar: readStoredSidebarWidth(), rightbar: readStoredRightbarWidth() },
    ),
  );
  const [dragging, setDragging] = useState(false);

  const setViewportWidth = useCallback((width: number): void => {
    setLayout((state) => setViewportWidthState(state, width));
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
  // through the same effect. A closed sidebar (0) is a presentation and not a
  // width, so it removes the entry — the next launch starts expanded, which is
  // also the reference's boot state (`useState(true)`).
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
    }),
    [layout, dragging, setViewportWidth, setSidebar, setRightbar, openRightbar, closeRightbar, toggleSidebar],
  );
}
