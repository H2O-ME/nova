/**
 * Resident conversation skeleton, ported from deepseek-harness
 * `ui-conversation/src/client/skeleton/ConversationRoot.tsx` (c) 2026 DeepSeek
 * — MIT License. Hero chrome, composer positioning, the scrollport, the shared
 * width axis and the transcript width handles stay mounted across
 * hero/settling/active transitions, so a session landing never remounts the
 * composer.
 *
 * Ownership: this file owns placement and measurement, never content. The
 * header, the hero block, the transcript and the composer arrive as slots.
 * Outward it publishes the three measurements floating chrome reads off the
 * column: `--dsh-conversation-column-width` (the width axis every child
 * measures against), `--dsh-composer-height` and
 * `--dsh-conversation-viewport-height` (both off the scroll body, which is
 * also the scrollport the transcript finds via `[data-conversation-scroll]`).
 */
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  handleWidth,
  readWidthPreference,
  resolveContentWidth,
  writeWidthPreference,
} from './content-width.js';
import type { ConversationPhase } from './phase.js';
import { wheelDeltaY } from '../composer/composer-measure.js';
import css from './ConversationRoot.module.css';

/** What the header slot is told about the phase it renders into. */
export interface HeaderSlotState {
  /** Blank/hero phases keep the strict header mounted but out of the column. */
  hidden: boolean;
}

export interface ConversationRootProps {
  /** Which of the three layouts the column is in (drives `data-phase`). */
  phase: ConversationPhase;
  /**
   * The strict session header (`conversation.session.header`). Omitted means
   * "no session bound, no header element at all"; a bound-but-blank session
   * keeps its header mounted and receives `hidden: true` instead.
   */
  header?: (state: HeaderSlotState) => ReactNode;
  /** Hero chrome (`conversation.hero`): the centered brand block above the card. */
  hero?: ReactNode;
  /**
   * The workspace row, rendered BETWEEN the hero chrome and the composer.
   *
   * A separate slot rather than part of `hero` because that is the reference's
   * own assembly: its `HeroShell` renders only the headline and this row is a
   * sibling of it inside the composer hero's 8px stack. Folding it into the hero
   * is what made the chip inherit the hero's own gutter and gap and drift off
   * the card's axis.
   */
  heroWorkspaceRow?: ReactNode;
  /** The transcript occupant (`conversation.session`), rendered in `.viewArea`. */
  session?: ReactNode;
  /** The composer chain output (dock cards + input card), sticky at the foot. */
  composer: ReactNode;
}

/** One transcript width handle: pointer capture + rAF-throttled symmetric
 * resize (both sides write the one centered width, so outward travel widens
 * by 2× the pointer distance). pointermove publishes the pointer's Y as a CSS
 * variable so the glow indicator rides it. Mirrors ui-layout AppFrame's
 * DragHandle capture model. */
function WidthHandle(props: {
  side: 'left' | 'right';
  onStart: () => number;
  onDrag: (width: number) => void;
  onCommit: (width: number) => void;
  onEnd: () => void;
}): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const base = useRef(0);
  const origin = useRef(0);
  const latest = useRef(0);
  const frame = useRef<number | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  const outwardWidth = (): number =>
    handleWidth(callbacks.current.side, base.current, latest.current - origin.current);
  const cancelFrame = (): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  };
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = e.clientX;
    latest.current = e.clientX;
    base.current = callbacks.current.onStart();
    setDragging(true);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    const box = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--dsh-width-handle-pointer-y', `${e.clientY - box.top}px`);
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    latest.current = e.clientX;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      callbacks.current.onDrag(outwardWidth());
    });
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    cancelFrame();
    latest.current = e.clientX;
    // Only a gesture with actual travel commits: a press-and-release on a
    // window-clamped width must not overwrite the wider stored preference
    // with the clamped display value.
    if (latest.current !== origin.current) callbacks.current.onCommit(outwardWidth());
    setDragging(false);
    callbacks.current.onEnd();
  }, []);
  // Releasing the button outside the window delivers pointercancel (or drops
  // the capture silently) instead of pointerup; without this the glow's
  // data-dragging state sticks on. The gesture is abandoned uncommitted —
  // onEnd republishes the stored preference. releasePointerCapture inside
  // onPointerUp also fires lostpointercapture, so this runs (idempotently)
  // after every normal drag end too; keep both paths.
  const onPointerCancel = useCallback((): void => {
    cancelFrame();
    setDragging(false);
    callbacks.current.onEnd();
  }, []);
  // The strip sits over the scrollport's gutter, so a wheel over it would
  // otherwise do nothing: forward the gesture to the transcript's scrollport
  // (the reference's `onWheel`). Under the conversation host the scrolling box
  // is the `[data-conversation-scroll]` element itself — the chat's own
  // `.scroll` stands down to `overflow: visible` there — so that is the one to
  // move. Ctrl-wheel is the browser's zoom and a zero delta carries no
  // direction, so both are left alone.
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.deltaY === 0) return;
    const body = e.currentTarget.parentElement;
    if (body === null) return;
    const scrollport = body.querySelector<HTMLElement>(':scope > [data-conversation-scroll]');
    if (scrollport === null) return;
    const lineHeight = Number.parseFloat(getComputedStyle(scrollport).lineHeight);
    scrollport.scrollBy({ top: wheelDeltaY(e, { lineHeight, clientHeight: scrollport.clientHeight }) });
  }, []);

  return (
    <div
      className={css.widthHandle}
      data-side={props.side}
      data-width-handle={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onWheel={onWheel}
    />
  );
}

export function ConversationRoot({
  phase,
  header,
  hero,
  heroWorkspaceRow,
  session,
  composer,
}: ConversationRootProps): JSX.Element {
  // Publishes the two live measurements floating View chrome reads off the
  // scroll body: the seat's height as --dsh-composer-height, so controls clear
  // the composer as it grows, and the scrollport's own height as
  // --dsh-conversation-viewport-height, so a control can sit in the band the
  // seat leaves visible. Callback ref, not an effect; stable identity prevents
  // observer churn while the first blank session fills the resident body
  // outlet.
  const seatObserver = useRef<ResizeObserver | null>(null);
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect();
    seatObserver.current = null;
    const scroller = seat?.parentElement ?? null;
    if (seat === null || scroller === null) return;
    seatObserver.current = new ResizeObserver(() => {
      scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`);
      scroller.style.setProperty(
        '--dsh-conversation-viewport-height',
        `${scroller.clientHeight}px`,
      );
    });
    seatObserver.current.observe(seat);
    seatObserver.current.observe(scroller);
  }, []);

  // Publishes the column's live width as --dsh-conversation-column-width so
  // the shared width axis can adapt (see the .root CSS), and re-clamps a
  // dragged preference against the shrunken column WITHOUT rewriting the
  // stored preference — widening the window restores it (the AppFrame
  // sidebar-drag rule). Same callback-ref pattern as the seat observer.
  const rootEl = useRef<HTMLDivElement | null>(null);
  const rootObserver = useRef<ResizeObserver | null>(null);
  const publishWidths = useCallback((root: HTMLDivElement): void => {
    const column = root.offsetWidth;
    root.style.setProperty('--dsh-conversation-column-width', `${column}px`);
    const preference = readWidthPreference();
    if (preference === null) {
      root.style.removeProperty('--dsh-chat-user-width');
    } else {
      root.style.setProperty('--dsh-chat-user-width', `${resolveContentWidth(column, preference)}px`);
    }
  }, []);
  const rootResizeRef = useCallback((root: HTMLDivElement | null): void => {
    rootObserver.current?.disconnect();
    rootObserver.current = null;
    rootEl.current = root;
    if (root === null) return;
    rootObserver.current = new ResizeObserver(() => {
      publishWidths(root);
    });
    rootObserver.current.observe(root);
    publishWidths(root);
  }, [publishWidths]);

  // Drag plumbing for the two width handles: onStart snapshots the resolved
  // width (grabbing a clamped column must not jump back to the raw stored
  // preference), onDrag publishes only the live clamped style, onCommit
  // persists the width of a gesture that actually travelled, and onEnd
  // republishes from storage — an uncommitted press leaves the stored
  // preference untouched.
  const onHandleStart = useCallback((): number => {
    const root = rootEl.current;
    if (root === null) return 680;
    return resolveContentWidth(root.offsetWidth, readWidthPreference());
  }, []);
  const onHandleDrag = useCallback((width: number): void => {
    const root = rootEl.current;
    if (root === null) return;
    root.style.setProperty('--dsh-chat-user-width', `${resolveContentWidth(root.offsetWidth, width)}px`);
  }, []);
  const onHandleCommit = useCallback((width: number): void => {
    const root = rootEl.current;
    if (root === null) return;
    writeWidthPreference(resolveContentWidth(root.offsetWidth, width));
  }, []);
  const onHandleEnd = useCallback((): void => {
    const root = rootEl.current;
    if (root !== null) publishWidths(root);
  }, [publishWidths]);

  const heroPhase = phase === 'hero';
  const composerSeat = (
    <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="">
      <div className={heroPhase ? `${css.composerStack} ${css.composerHero}` : css.composerStack}>
        {/* The reference's order: hero chrome, then the workspace row, then the
            composer. The row is only meaningful with the hero (once a
            transcript is on screen the header states the workspace), so it
            rides the same phase gate. */}
        {heroPhase && hero}
        {heroPhase && heroWorkspaceRow}
        {composer}
      </div>
    </div>
  );

  return (
    <div ref={rootResizeRef} className={css.root} data-phase={phase}>
      {header?.({ hidden: phase !== 'active' })}
      <div className={css.body}>
        <div className={css.scrollBody} data-conversation-scroll="">
          {session === undefined ? null : <div className={css.viewArea}>{session}</div>}
          {composerSeat}
        </div>
        {/* Width handles only while a transcript is on screen; the hero has no
            content column to size. */}
        {phase === 'active' &&
          (['left', 'right'] as const).map((side) => (
            <WidthHandle
              key={side}
              side={side}
              onStart={onHandleStart}
              onDrag={onHandleDrag}
              onCommit={onHandleCommit}
              onEnd={onHandleEnd}
            />
          ))}
      </div>
    </div>
  );
}