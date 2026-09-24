/**
 * The transcript scroller — port of the harness `ui-chat`'s `ChatView.tsx`
 * (scrollport + centered column + flow rhythm + back-to-bottom + load-older),
 * wired to this repo's `scroll-follow.ts`, which already carries the harness's
 * follow rules (`FOLLOW_THRESHOLD`, the observed-top ledger, `readerMoved`,
 * the paging anchor).
 *
 * What the caller owns, and what this file therefore does not do:
 *  - **The rows.** Every block becomes one {@link ChatFlowRow}; tool cards,
 *    reasoning rows, message rows and compactions are the caller's components.
 *    A row's wrapper carries the harness's seat hooks
 *    (`data-chat-anchor-key` / `data-chat-flow-kind`) plus the flow-gap rule's
 *    `data-turn-process-answer` marker.
 *  - **The composer.** It is NOT here: the harness keeps it outside the
 *    transcript, in the conversation root's composer seat, so the scrollport
 *    below ends where the seat begins. The width axis is published once, by
 *    that same root.
 *
 * The harness's turn navigator rail, transcript search and host error dialogs
 * are not part of this port.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDownGlyph14 } from './glyphs.js';
import { anchorRow, atFloor, floorTop, flowTop, readerMoved, restoredTop } from '../scroll-follow.js';
import type { ScrollAnchor } from '../scroll-follow.js';
import css from './ChatView.module.css';

/** What a flow row IS, for the column's rhythm rules. */
export type ChatFlowKind = 'user' | 'steering' | 'assistant' | 'process' | 'tool' | 'notice';

export interface ChatFlowRow {
  /** Stable identity: the React key, the prepend anchor and the flow's head/tail. */
  key: string;
  kind: ChatFlowKind;
  /** The rendered row. */
  node: ReactNode;
}

/** The live turn's one-line status (the harness's shimmering running row). */
export interface ChatTurnStatus {
  /** What the turn is doing (`生成中`, `执行工具`, …). */
  label: string;
  /** Optional live clock, tabular-nums in the ported sheet. */
  clock?: string | undefined;
}

export interface ChatViewProps {
  rows: readonly ChatFlowRow[];
  /** Older blocks the baseline holds but this browser has not loaded (0 = none). */
  hiddenOlder?: number | undefined;
  /** A `load_earlier` page is in flight (the reducer owns that flag). */
  loadingOlder?: boolean | undefined;
  /** Ask the host for the next older page. */
  onLoadEarlier?: (() => void) | undefined;
  /** Live turn status; null/absent = idle. */
  status?: ChatTurnStatus | null | undefined;
  /** Rendered in the column when there is nothing to read. */
  empty?: ReactNode;
}

export function ChatView({
  rows,
  hiddenOlder = 0,
  loadingOlder = false,
  onLoadEarlier,
  status = null,
  empty,
}: ChatViewProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  /** The pinned reader follows; the ref is the truth, the state only paints. */
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  /** Last scrollTop written or read — reader input is deviation from it. */
  const observedTopRef = useRef(0);
  /** Flow head/tail at the last settle: a changed head with the old one still
   *  present is a prepend; a changed tail is an append. */
  const headRef = useRef<string | null>(null);
  const tailRef = useRef<string | null>(null);
  /** Reading position held across an in-flight `load_earlier`. */
  const anchorRef = useRef<ScrollAnchor | null>(null);

  /** Programmatic write — the one place scrollTop moves without the reader. */
  const writeTop = useCallback((el: HTMLDivElement, top: number): void => {
    el.scrollTop = top;
    observedTopRef.current = el.scrollTop;
  }, []);

  const toBottom = useCallback((el: HTMLDivElement): void => {
    writeTop(el, el.scrollHeight);
    anchorRef.current = null;
    if (!atBottomRef.current) {
      atBottomRef.current = true;
      setAtBottom(true);
    }
  }, [writeTop]);

  /**
   * One settlement: decide who owns the scrollport, then act on it. Called
   * after every flow change, scroll event and resize — a pinned reader keeps
   * the tail; a reader who scrolled is never moved by growth.
   */
  const settle = useCallback((): void => {
    const el = boxRef.current;
    if (el === null) return;
    const floor = floorTop(el.scrollHeight, el.clientHeight);
    if (!readerMoved(el.scrollTop, floor, observedTopRef.current)) {
      // Growth moved the floor, or we made this write ourselves: ownership
      // stands. A pinned reader follows the tail (the streaming follow).
      if (atBottomRef.current) toBottom(el);
      return;
    }
    const pinned = atFloor(el.scrollTop, el.scrollHeight, el.clientHeight);
    observedTopRef.current = el.scrollTop;
    if (pinned) anchorRef.current = null;
    if (pinned !== atBottomRef.current) {
      atBottomRef.current = pinned;
      setAtBottom(pinned);
    }
  }, [toBottom]);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const onScroll = (): void => settle();
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, [settle]);

  // Dynamic height: streaming text, tool disclosures and the dock's own
  // growth all resize the flow without a scroll event of their own.
  useEffect(() => {
    const col = columnRef.current;
    const box = boxRef.current;
    if (col === null || box === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => settle());
    observer.observe(col);
    observer.observe(box);
    return () => observer.disconnect();
  }, [settle]);

  // Geometry decisions run before paint: the reader must never see a frame at
  // the pre-settle position.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const head = rows[0]?.key ?? null;
    const tail = rows[rows.length - 1]?.key ?? null;
    const previousHead = headRef.current;
    const previousTail = tailRef.current;
    headRef.current = head;
    tailRef.current = tail;
    if (previousHead !== null && !rows.some((row) => row.key === previousHead)) {
      // A (re)`ready` replaced the transcript wholesale: nothing to preserve.
      toBottom(el);
      return;
    }
    if (previousHead !== null && head !== previousHead) {
      // A prepend: put the anchored row back where the reader had it.
      const anchor = anchorRef.current;
      anchorRef.current = null;
      if (anchor !== null) {
        const row = anchorElement(el, anchor.key);
        if (row !== null) writeTop(el, restoredTop(el.scrollTop, flowTop(row, el), anchor.top));
      }
      return;
    }
    // Our own words must be visible (the send lives in the composer, so
    // arrival is detected here, not armed there).
    if (tail !== previousTail && rows[rows.length - 1]?.kind === 'user') {
      toBottom(el);
      return;
    }
    settle();
  }, [rows, settle, toBottom, writeTop]);

  const loadEarlier = (): void => {
    if (loadingOlder || onLoadEarlier === undefined) return;
    const el = boxRef.current;
    const col = columnRef.current;
    if (el !== null && col !== null) {
      const row = anchorRow([...col.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')], el);
      if (row !== null) {
        anchorRef.current = { key: row.dataset['chatAnchorKey'] ?? '', top: flowTop(row, el) };
      }
    }
    onLoadEarlier();
  };

  const scrollDown = (): void => {
    const el = boxRef.current;
    if (el !== null) toBottom(el);
  };

  return (
    <div className={css.root} ref={rootRef}>
      <div className={css.scroll} ref={boxRef}>
        <div className={css.column} data-chat-flow="" ref={columnRef}>
          {hiddenOlder > 0 && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadEarlier}>
                {loadingOlder ? '加载中…' : `加载更早（还有 ${hiddenOlder} 条）`}
              </button>
            </div>
          )}
          {rows.length === 0 && hiddenOlder === 0 && empty}
          {rows.map((row, index) => (
            <div
              key={row.key}
              className={row.kind === 'tool' ? `${css.flowItem} ${css.callRow}` : css.flowItem}
              data-chat-anchor-key={row.key}
              data-chat-flow-kind={row.kind}
              data-turn-process-answer={row.kind === 'assistant' && rows[index - 1]?.kind === 'process' ? '' : undefined}
            >
              {row.node}
            </div>
          ))}
          {/* Turn-level loading signal: rides the whole running turn (first-token
              wait, tool execution, streaming) so it never flickers per step. */}
          {status !== null && status !== undefined && <TurnStatusRow label={status.label} clock={status.clock} />}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label="回到底部"
              title="回到底部"
              onClick={scrollDown}
            >
              <ChevronDownGlyph14 />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The turn's running row (`.turnStatus` + its optional clock). */
export function TurnStatusRow({ label, clock }: { label: string; clock?: string | undefined }): JSX.Element {
  return (
    <div className={css.turnStatus} role="status">
      {label}
      {clock !== undefined && <span className={css.turnStatusClock}>{clock}</span>}
    </div>
  );
}

/** A hint line: quiet secondary prose, or the error tone for a failure. */
export function ChatHintRow({ text, tone }: { text: string; tone: 'info' | 'warn' }): JSX.Element {
  return <div className={tone === 'warn' ? css.openError : css.hint}>{text}</div>;
}

/** Row lookup by flow identity (never by interpolated selector). */
function anchorElement(scope: HTMLElement, key: string): HTMLElement | null {
  for (const row of scope.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset['chatAnchorKey'] === key) return row;
  }
  return null;
}