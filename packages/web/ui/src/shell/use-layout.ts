/**
 * Frame measurement and column preferences as a React binding, ported from
 * deepseek-harness `ui-layout` (MIT). All the decisions live in
 * `layout-store.ts` (pure, directly tested); this module only owns the state
 * cell, the `dragging` flag the tracks read, and the stable action identities
 * `AppFrame`'s effects depend on.
 */
import { useCallback, useMemo, useState } from 'react';
import { SIDEBAR_AUTO_COLLAPSE } from './columns.js';
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

export interface LayoutBinding {
  layout: LayoutState;
  /** True while a column drag is in flight (pauses the track transitions). */
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  setViewportWidth: (width: number) => void;
  setSidebar: (px: number) => void;
  setRightbar: (px: number) => void;
  openRightbar: (track: boolean, fullscreen: boolean) => void;
  closeRightbar: () => void;
  toggleSidebar: () => void;
  /** Whether the sidebar renders as the collapsed rail. */
  collapsed: boolean;
  /** Below the breakpoint the expanded sidebar floats over the centre. */
  narrow: boolean;
}

export function useLayout(): LayoutBinding {
  const [layout, setLayout] = useState<LayoutState>(initialLayout);
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
  const openRightbar = useCallback((track: boolean, fullscreen: boolean): void => {
    setLayout((state) => openRightbarState(state, track, fullscreen));
  }, []);
  const closeRightbar = useCallback((): void => {
    setLayout((state) => closeRightbarState(state));
  }, []);
  const toggleSidebar = useCallback((): void => {
    setLayout((state) => toggleSidebarState(state));
  }, []);

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
      narrow: layout.viewportWidth < SIDEBAR_AUTO_COLLAPSE,
    }),
    [
      layout,
      dragging,
      setViewportWidth,
      setSidebar,
      setRightbar,
      openRightbar,
      closeRightbar,
      toggleSidebar,
    ],
  );
}