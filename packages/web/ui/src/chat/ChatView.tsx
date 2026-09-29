/**
 * The transcript scroller — port of the harness `ui-chat`'s `ChatView.tsx`
 * (scrollport + centered column + flow rhythm + back-to-bottom + load-older),
 * wired to this repo's `scroll-follow.ts`, which already carries the harness's
 * follow rules (`FOLLOW_THRESHOLD`, the observed-top ledger, `readerMoved`,
 * the paging anchor).
 *
 * What the caller owns, and what this file therefore does not do:
 *  - **The rows.** Every block becomes one {@link ChatFlowRow}; turn headers,
 *    tool cards, reasoning rows, message rows and compactions are the
 *    caller's components (the live turn's label rides its turn header now,
 *    not a status row here).
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
import { ProcessGroup } from './ProcessGroup.js';
import { anchorRow, atFloor, floorTop, flowTop, readerMoved, restoredTop, scrollportOf } from '../scroll-follow.js';
import type { ScrollAnchor } from '../scroll-follow.js';
import css from './ChatView.module.css';

/**
 * What a flow row IS, for the column's rhythm rules. `tail` is the turn's
 * closing chrome (copy/branch, usage pill, clock): its own row so the column's
 * 16px rhythm separates it from the answer as a sibling — the harness renders
 * that footer as a separate `turn-tail` node, not inside the answer's row.
 */
export type ChatFlowKind = 'user' | 'steering' | 'assistant' | 'process' | 'tool' | 'notice' | 'tail';

export interface ChatFlowRow {
  /** Stable identity: the React key, the prepend anchor and the flow's head/tail. */
  key: string;
  kind: ChatFlowKind;
  /** The rendered row. */
  node: ReactNode;
  /**
   * The bounded process group this row belongs to, when it belongs to one.
   * Adjacent rows sharing an id are drawn inside a single
   * {@link ProcessGroup} — the harness's per-Turn step box. Rows without it
   * stay direct children of the column.
   */
  group?: { id: string; live: boolean } | undefined;
}

/** The live turn's label (the running turn header's words). */
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
  /** Rendered in the column when there is nothing to read. */
  empty?: ReactNode;
}

export function ChatView({
  rows,
  hiddenOlder = 0,
  loadingOlder = false,
  onLoadEarlier,
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

  /** The scrollport in force, resolved lazily so the first paint finds it too. */
  const port = useCallback((): HTMLDivElement | null => {
    const box = boxRef.current;
    if (box === null) return null;
    return scrollportOf(box);
  }, []);

  /** Programmatic write — the one place scrollTop moves without the reader. */
  const writeTop = useCallback((el: HTMLDivElement, top: number): void => {
    el.scrollTop = top;
    observedTopRef.current = el.scrollTop;
  }, []);

  const toBottom = useCallback((el: HTMLDivElement): void => {
    // `scrollHeight` on the port, not the box: the transcript box is only as
    // tall as its content there, so asking it for a floor would always answer
    // "already at the bottom".
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
    const el = port();
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
  }, [toBottom, port]);

  useEffect(() => {
    // The listener belongs on the scrollport, not on the transcript box: the
    // box emits nothing once the host takes over scrolling.
    const el = port();
    if (el === null) return;
    const onScroll = (): void => settle();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [settle, port]);

  // Dynamic height: streaming text, tool disclosures and the dock's own
  // growth all resize the flow without a scroll event of their own.
  useEffect(() => {
    const col = columnRef.current;
    const box = boxRef.current;
    const el = port();
    if (col === null || box === null || el === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => settle());
    observer.observe(col);
    // The scrollport's own box too: a shrinking viewport (or a dock growing
    // under it) changes the floor without touching the column's height.
    observer.observe(el);
    if (el !== box) observer.observe(box);
    return () => observer.disconnect();
  }, [settle, port]);

  // Geometry decisions run before paint: the reader must never see a frame at
  // the pre-settle position.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const el = port();
    if (box === null || el === null) return;
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
      // A prepend: put the anchored row back where the reader had it. The
      // anchor arithmetic runs in the scrollport's own coordinates, so the row
      // lookup and both reads use the port as the reference box.
      const anchor = anchorRef.current;
      anchorRef.current = null;
      if (anchor !== null) {
        const row = anchorElement(box, anchor.key);
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
  }, [rows, settle, toBottom, writeTop, port]);

  const loadEarlier = (): void => {
    if (loadingOlder || onLoadEarlier === undefined) return;
    const box = boxRef.current;
    const col = columnRef.current;
    const el = port();
    if (box !== null && col !== null && el !== null) {
      const row = anchorRow([...col.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')], el);
      if (row !== null) {
        anchorRef.current = { key: row.dataset['chatAnchorKey'] ?? '', top: flowTop(row, el) };
      }
    }
    onLoadEarlier();
  };

  const scrollDown = (): void => {
    const el = port();
    if (el !== null) toBottom(el);
  };

  return (
    <div className={css.frame}>
      <div className={css.root} ref={rootRef} data-chat-following-tail={atBottom ? '' : undefined}>
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
            {renderFlowRows(rows, css)}
          </div>
        </div>
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
  );
}

/** A hint line: quiet secondary prose, or the error tone for a failure. */
export function ChatHintRow({ text, tone }: { text: string; tone: 'info' | 'warn' }): JSX.Element {
  return <div className={tone === 'warn' ? css.openError : css.hint}>{text}</div>;
}

/**
 * Draw the flow, wrapping each run of adjacent rows that share a `group` id in
 * one {@link ProcessGroup} — the harness's per-Turn step box.
 *
 * The grouping happens HERE, at render, rather than while building the list:
 * `flowRows` stays a faithful flat projection of the log (a turn's answer keeps
 * its log position even when steps surround it), and only the drawing decides
 * what a bounded box contains. Rows whose group differs from their neighbour's
 * open and close their own box.
 * @param rows - the flow rows, in order.
 * @param styles - the sheet carrying `.flowItem` / `.callRow`.
 * @returns the column's children.
 */
function renderFlowRows(
  rows: readonly ChatFlowRow[],
  styles: typeof css,
): JSX.Element[] {
  // A CLOSED process reads as one summary immediately followed by its answer:
  // that answer's row carries the tighter 8px rhythm. An EXPANDED turn emits its
  // process rows as group members, so a member sitting directly before the answer
  // withholds the marker and leaves the 16px rhythm the expanded body sets. The
  // mark is decided over the WHOLE flow here, because grouping moves process rows
  // into a box: the answer's predecessor in flow order may no longer be its DOM
  // sibling.
  const answersAfterProcess = new Set<string>();
  for (let at = 1; at < rows.length; at += 1) {
    const row = rows[at];
    const previous = rows[at - 1];
    if (row !== undefined && row.kind === 'assistant'
      && previous !== undefined && previous.kind === 'process'
      && previous.group === undefined) {
      answersAfterProcess.add(row.key);
    }
  }

  const box = (member: ChatFlowRow): JSX.Element => (
    <div
      key={member.key}
      className={member.kind === 'tool' ? `${styles.flowItem} ${styles.callRow}` : styles.flowItem}
      data-chat-anchor-key={member.key}
      data-chat-flow-kind={member.kind}
      data-turn-process-answer={answersAfterProcess.has(member.key) ? '' : undefined}
    >
      {member.node}
    </div>
  );

  const out: JSX.Element[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (row === undefined) break;
    const group = row.group;
    if (group === undefined) {
      out.push(box(row));
      index += 1;
      continue;
    }
    // One bounded box per run of adjacent rows sharing the group id.
    const members: ChatFlowRow[] = [];
    while (index < rows.length && rows[index]?.group?.id === group.id) {
      const member = rows[index];
      if (member !== undefined) members.push(member);
      index += 1;
    }
    out.push(
      <ProcessGroup key={group.id} live={group.live}>
        {members.map(box)}
      </ProcessGroup>,
    );
  }
  return out;
}

/** Row lookup by flow identity (never by interpolated selector). */
function anchorElement(scope: HTMLElement, key: string): HTMLElement | null {
  for (const row of scope.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset['chatAnchorKey'] === key) return row;
  }
  return null;
}