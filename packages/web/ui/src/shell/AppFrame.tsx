/**
 * Three-column shell frame. Owns the grid tracks (sidebar |
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
} from './columns.js';
import type { LayoutState } from './layout-store.js';
import { sidebarCollapsed, sidebarPreference } from './layout-store.js';
import { isDesktopShell } from './desktop-shell.js';
import css from './AppFrame.module.css';

/** What the sidebar occupant needs to know about its own column. */
export interface SidebarSlotParams {
  collapsed: boolean;
  width: number;
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
  /**
   * The window's top-left cluster (`TopOverlay`). It is a frame child, not a
   * sidebar child: the way back to the column has to survive the column
   * closing, and the reference keeps it in the shell for exactly that reason
   * (`DesktopTopOverlay` is rendered by the layout, never by the sidebar).
   */
  topOverlay?: ReactNode;
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
 * Right column grid item: the third column of the shell (2026-11-21). It owns
 * the track the solver reserved, so the centre makes room and all three panels
 * stand on the same ground — the reference's three-panel shell. The panel draws
 * its own inset, border and radius inside this box.
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
  topOverlay,
  overlay,
}: AppFrameProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewport = layout.viewportWidth;

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  // The conversation column is only MARKED here (`data-conversation-measure`);
  // the auto-collapse policy reads it off the DOM on a window resize, so no
  // width has to be piped through state for a timer to read later.
  const conversationRef = useRef<HTMLDivElement | null>(null);
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

  const collapsed = sidebarCollapsed(layout);
  const preference = sidebarPreference(layout);
  const rightbarPreference = layout.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO;
  // All three widths are solved together: the right panel now owns a real
  // track, so a narrow frame removes it exactly like any other concession
  // (the centre keeps its floor; the panel falls back to `takeover` in the
  // occupant, which is why `canShow` is derived from the solved width).
  const cols = computeColumns(viewport, preference, layout.rightbarTrack ? rightbarPreference : 0);
  const colsRef = useRef(cols);
  colsRef.current = cols;

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
    rightbarBase.current = colsRef.current.rightbar;
    onDragChange(true);
  }, [onDragChange]);
  const onRightbarDrag = useCallback(
    (dx: number): void => onRightbarWidth(rightbarBase.current - dx),
    [onRightbarWidth],
  );

  const sidebarNode = useMemo(
    () => sidebar({ collapsed, width: cols.sidebar }),
    [sidebar, collapsed, cols.sidebar],
  );
  const rightbarNode = useMemo(
    () =>
      rightbar?.({ width: cols.rightbar, viewportWidth: viewport, canShow: cols.rightbar > 0 }),
    [rightbar, cols.rightbar, viewport],
  );

  return (
      <div ref={frameRef} className={css.frame}
      style={{
        gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px`,
      }}
      {...(collapsed ? { 'data-sidebar-collapsed': '' } : {})}
      {...(cols.rightbar === 0 ? { 'data-rightbar-collapsed': '' } : {})}
      {...(layout.rightbarFullscreen ? { 'data-rightbar-fullscreen': '' } : {})}
      {...(layout.rightbarInstant ? { 'data-rightbar-instant': '' } : {})}
      {...(dragging ? { 'data-dragging': '' } : {})}
      {...(animating > 0 ? { 'data-animating': '' } : {})}
      {...(isDesktopShell() ? { 'data-desktop': '' } : {})}
    >
      <div className={css.sidebarCol}>{sidebarNode}</div>
      <>
        <CenterColumn>
          {/* The measured box the auto-collapse policy watches. It wraps the
              occupant rather than reading it: the occupant is a slot array, so
              there is no single element to observe, and the column's own grid
              track is not an element. */}
          <div ref={conversationRef} className={css.conversationMeasure} data-conversation-measure="">
            {center}
          </div>
        </CenterColumn>
        <RightbarColumn>{rightbarNode}</RightbarColumn>
      </>
      {/* The Windows ground's top strip is the frameless window's drag bar
          (the reference gives the content container a `w-full [app-region:drag]`
          strip above the panel). Nova's ground reveal is the panels' 6px top
          margin — dead, unclickable space without this. It spans the centre and
          right tracks only (the sidebar's own logo row is the drag seat there),
          sits under every panel (it covers margin, never chrome), and renders
          in the desktop shell only — in a browser it would silently eat clicks
          on the strip for nothing. */}
      {isDesktopShell() && <div className={css.topDragStrip} data-tauri-drag-region="" aria-hidden="true" />}
      {/* Above the columns, below the shell's overlay layer: the cluster floats
          over the sidebar's seat while it is open and over the conversation's
          top-left corner while it is closed (TopOverlay.tsx). */}
      {topOverlay}
      {overlay !== undefined && <div className={css.overlayLayer}>{overlay}</div>}
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!collapsed && (
        <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />
      )}
      {/* The panel owns the third track; its drag handle sits on that track's
          left border, the same edge the sidebar's handle sits on. */}
      {layout.rightbarShown && !layout.rightbarFullscreen && cols.rightbar > 0 && (
        <DragHandle
          side="rightbar"
          left={viewport - cols.rightbar}
          onStart={onRightbarStart}
          onDrag={onRightbarDrag}
          onEnd={onDragEnd}
        />
      )}
    </div>
  );
}
