/**
 * Frame measurement and the right panel's width preference as a React
 * binding, ported from deepseek-harness `ui-layout` (MIT). All the decisions
 * live in `layout-store.ts` (pure, directly tested); this module only owns the
 * state cell, the `dragging` flag the tracks read, and the stable action
 * identities `AppFrame`'s effects depend on.
 */
import { useCallback, useMemo, useState } from 'react';
import type { LayoutState } from './layout-store.js';
import {
  closeRightbar as closeRightbarState,
  initialLayout,
  openRightbar as openRightbarState,
  setRightbar as setRightbarState,
  setViewportWidth as setViewportWidthState,
} from './layout-store.js';

export interface LayoutBinding {
  layout: LayoutState;
  /** True while a column drag is in flight (pauses the track transitions). */
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  setViewportWidth: (width: number) => void;
  setRightbar: (px: number) => void;
  openRightbar: (fullscreen: boolean) => void;
  closeRightbar: () => void;
}

export function useLayout(): LayoutBinding {
  const [layout, setLayout] = useState<LayoutState>(initialLayout);
  const [dragging, setDragging] = useState(false);

  const setViewportWidth = useCallback((width: number): void => {
    setLayout((state) => setViewportWidthState(state, width));
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

  return useMemo(
    () => ({
      layout,
      dragging,
      setDragging,
      setViewportWidth,
      setRightbar,
      openRightbar,
      closeRightbar,
    }),
    [layout, dragging, setViewportWidth, setRightbar, openRightbar, closeRightbar],
  );
}
