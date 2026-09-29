/**
 * Three-column shell frame, ported from deepseek-harness
 * `ui-layout/src/client/AppFrame.tsx` (MIT). Owns the grid tracks (sidebar |
 * center | rightbar), the drag handles (pointer capture + rAF throttle), the
 * column solve (`columns.ts`), and the child render decisions: the sidebar
 * occupant receives the resolved collapse state and width, the right column
 * occupant receives its presentation parameters.
 *
 * The right column is a track, not a box: its occupant draws its panel
 * anchored to the frame's right edge at the resolved normal width, and the
 * track only decides whether the centre makes room for it. The occupant
 * reports shown/track/fullscreen back through `layout-store`; fullscreen keeps
 * the reported track but hides the outer resize handle.
 *
 * Track easing is scoped to a discrete collapse/expand toggle, never to a
 * steady-state viewport update: an eased track would chase the live window edge
 * and visibly rubber-band the centre column while the user resizes. The
 * `data-animating` attribute the stylesheet gates on is held across the toggle
 * and released at `transitionend`, so the CSS and this component stay one
 * mechanism rather than two.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  computeColumns,
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE,
} from './columns.js';
import type { LayoutState } from './layout-store.js';
import { sidebarCollapsed, sidebarPreference } from './layout-store.js';
import css from './AppFrame.module.css';

/** What the sidebar occupant needs to know about its own column. */
export interface SidebarSlotParams {
  collapsed: boolean;
  width: number;
  /**
   * The collapse is the NARROW-FRAME auto-collapse rather than the reader's own
   * choice. The two look identical in a 56px rail, and they mean different
   * things: one is a state the reader chose, the other is a state the window
   * imposed on them. The occupant needs the difference to make the way back
   * discoverable (its toggle names the reason and keeps the accent), which is the
   * defect the rail-only affordance left: a sidebar that "just disappeared".
   */
  auto: boolean;
}

/** What the right column occupant needs to know about its own column. */
export interface RightbarSlotParams {
  /** Resolved normal panel width in px (0 = the column has no track). */
  width: number;
  viewportWidth: number;
  canShow: boolean;
}

export interface AppFrameProps {
  layout: LayoutState;
  /** Publish the frame's own measured width (rAF-throttled ResizeObserver). */
  onViewportWidth: (width: number) => void;
  onSidebarWidth: (px: number) => void;
  onRightbarWidth: (px: number) => void;
  /** Whether a sidebar drag is in flight (the tracks pause their transition). */
  dragging: boolean;
  onDragChange: (dragging: boolean) => void;
  sidebar: (params: SidebarSlotParams) => ReactNode;
  center: ReactNode;
  /** Right column occupant; also responsible for reporting its presentation. */
  rightbar?: (params: RightbarSlotParams) => ReactNode;
  /** Shell overlays (dialogs, command palettes) above every column. */
  overlay?: ReactNode;
}

/**
 * Center column grid item (session-body building block).
 */
function CenterColumn({ children }: { children?: ReactNode }): JSX.Element {
  return <div className={css.centerCol}>{children}</div>;
}

/**
 * Right column grid item. Zero-width unless the occupant asked for a track; the
 * occupant's panel is positioned against the column's right edge, which never
 * moves, so it can hang over the centre when there is no track.
 */
function RightbarColumn({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div className={css.rightbarCol} data-rightbar-col="">
      {children}
    </div>
  );
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the
 * drag-start origin. `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: {
  side: 'sidebar' | 'rightbar';
  left: number;
  onStart: () => void;
  onDrag: (dx: number) => void;
  onEnd: () => void;
}): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const latest = useRef(0);
  const frame = useRef<number | null>(null);
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null);
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd });
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd };

  const endDrag = useCallback((): void => {
    const active = capture.current;
    if (active === null) return;
    capture.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
    setDragging(false);
    callbacks.current.onEnd();
  }, []);
  useEffect(() => endDrag, [endDrag]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || capture.current !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    capture.current = { element: e.currentTarget, id: e.pointerId };
    origin.current = e.clientX;
    latest.current = e.clientX;
    callbacks.current.onStart();
    setDragging(true);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (capture.current?.id !== e.pointerId) return;
    latest.current = e.clientX;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      callbacks.current.onDrag(latest.current - origin.current);
    });
  }, []);
  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (capture.current?.id !== e.pointerId) return;
      callbacks.current.onDrag(e.clientX - origin.current);
      endDrag();
    },
    [endDrag],
  );
  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (capture.current?.id === e.pointerId) endDrag();
    },
    [endDrag],
  );

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  );
}

/** The three-column frame (see module doc). */
export function AppFrame({
  layout,
  onViewportWidth,
  onSidebarWidth,
  onRightbarWidth,
  dragging,
  onDragChange,
  sidebar,
  center,
  rightbar,
  overlay,
}: AppFrameProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewport = layout.viewportWidth;

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current;
    if (el === null) return;
    let raf: number | null = null;
    let disposed = false;
    const measure = (): void => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) onViewportWidth(width);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      raf ??= requestAnimationFrame(() => {
        raf = null;
        measure();
      });
    });
    observer.observe(el);
    return () => {
      disposed = true;
      observer.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [onViewportWidth]);

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
  const collapsed = sidebarCollapsed(layout);
  const preference = sidebarPreference(layout);
  // The auto-collapse is a fact about WHY the rail is drawn, and it is only true
  // while the frame is narrow AND the rail is closed (a reader who expanded it
  // below the breakpoint has already answered the question).
  const autoCollapsed = narrow && collapsed;
  const rightbarPreference = layout.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO;
  // Opening on a narrow frame collapses the left sidebar. Eligibility must
  // include that space before the occupant's first shown report arrives.
  const normal = computeColumns(viewport, !layout.rightbarShown && narrow ? 0 : preference, rightbarPreference);
  const cols = computeColumns(viewport, preference, layout.rightbarTrack ? rightbarPreference : 0);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const rightbarWidth = useRef(normal.rightbar);
  rightbarWidth.current = normal.rightbar;

  // Track easing is scoped to a discrete open/close toggle, never to a
  // steady-state viewport update: an eased track would chase the live window
  // edge and visibly rubber-band the centre column while the user resizes.
  // The counter goes up on a toggle, comes down at `transitionend` (with a
  // 600ms timeout as the reduced-motion and covered-frame fallback), and
  // restarts when a re-toggle interrupts a running transition.
  const [animating, setAnimating] = useState(0);
  const toggle = `${collapsed}:${layout.rightbarTrack}`;
  const previousToggle = useRef(toggle);
  const previousViewport = useRef(viewport);
  useLayoutEffect(() => {
    const viewportChanged = previousViewport.current !== viewport;
    previousViewport.current = viewport;
    if (previousToggle.current === toggle) return;
    previousToggle.current = toggle;
    // A toggle arriving together with a viewport change is the responsive
    // auto-collapse firing mid window-resize; that one stays instant.
    if (viewportChanged) return;
    setAnimating((token) => token + 1);
  }, [toggle, viewport]);
  useEffect(() => {
    if (animating === 0) return;
    const frame = frameRef.current;
    if (frame === null) return;
    const settle = (): void => setAnimating(0);
    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === frame && event.propertyName === 'grid-template-columns') settle();
    };
    frame.addEventListener('transitionend', onTransitionEnd);
    const timer = setTimeout(settle, 600);
    return () => {
      frame.removeEventListener('transitionend', onTransitionEnd);
      clearTimeout(timer);
    };
  }, [animating]);

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0);
  const rightbarBase = useRef(0);
  const onDragEnd = useCallback((): void => onDragChange(false), [onDragChange]);
  const onSidebarStart = useCallback((): void => {
    sidebarBase.current = colsRef.current.sidebar;
    onDragChange(true);
  }, [onDragChange]);
  const onSidebarDrag = useCallback(
    (dx: number): void => onSidebarWidth(sidebarBase.current + dx),
    [onSidebarWidth],
  );
  const onRightbarStart = useCallback((): void => {
    rightbarBase.current = rightbarWidth.current;
    onDragChange(true);
  }, [onDragChange]);
  const onRightbarDrag = useCallback(
    (dx: number): void => onRightbarWidth(rightbarBase.current - dx),
    [onRightbarWidth],
  );

  const sidebarNode = useMemo(
    () => sidebar({ collapsed, width: cols.sidebar, auto: autoCollapsed }),
    [sidebar, collapsed, cols.sidebar, autoCollapsed],
  );
  const rightbarNode = useMemo(
    () =>
      rightbar?.({ width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 }),
    [rightbar, normal.rightbar, viewport],
  );

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px` }}
      {...(collapsed ? { 'data-sidebar-collapsed': '' } : {})}
      {...(autoCollapsed ? { 'data-sidebar-auto-collapsed': '' } : {})}
      {...(cols.rightbar === 0 ? { 'data-rightbar-collapsed': '' } : {})}
      {...(layout.rightbarFullscreen ? { 'data-rightbar-fullscreen': '' } : {})}
      {...(layout.rightbarInstant ? { 'data-rightbar-instant': '' } : {})}
      {...(dragging ? { 'data-dragging': '' } : {})}
      {...(animating > 0 ? { 'data-animating': '' } : {})}
    >
      <div className={css.sidebarCol}>{sidebarNode}</div>
      <>
        <CenterColumn>{center}</CenterColumn>
        <RightbarColumn>{rightbarNode}</RightbarColumn>
      </>
      {overlay !== undefined && <div className={css.overlayLayer}>{overlay}</div>}
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!collapsed && (
        <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />
      )}
      {layout.rightbarShown && !layout.rightbarFullscreen && normal.rightbar > 0 && (
        <DragHandle
          side="rightbar"
          left={viewport - normal.rightbar}
          onStart={onRightbarStart}
          onDrag={onRightbarDrag}
          onEnd={onDragEnd}
        />
      )}
    </div>
  );
}