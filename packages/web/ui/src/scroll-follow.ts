/**
 * Follow-scroll ownership (harness ChatView port: `FOLLOW_THRESHOLD`,
 * `readerMovedScroll`, the observed-top ledger). The transcript stays pinned to
 * the live tail while the reader has not taken over, and hands ownership over
 * the moment they scroll — content growing under a reader's eye must never move
 * it. The hard part is telling reader input from our own writes, and DOM growth
 * from both.
 *
 * Two mechanisms, both here as pure predicates so they can be tested without a
 * DOM:
 *  - **The observed-top ledger.** Every programmatic write records the
 *    scrollTop it produced. A scroll event whose position deviates from that
 *    ledger is reader input; nothing else is. Growth moves the *floor* (and the
 *    browser may clamp a pinned position to it), which the ledger accounts for.
 *  - **A 24px threshold**, not a screenful: "pinned" means at the tail, and a
 *    reader who stops 30px short is reading, not following.
 */
export const FOLLOW_THRESHOLD = 24;

/** The browser clamps scrollTop here when the content shrinks under it. */
export function floorTop(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/** Distance-to-floor within the threshold (+1 slack for sub-pixel floors). */
export function atFloor(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= FOLLOW_THRESHOLD + 1;
}

/**
 * Did the reader move the scrollport? Only ledger-deviating deliveries count:
 * shrink clamps land exactly on the floor, and programmatic writes land on the
 * ledger itself, so both preserve whatever ownership was in force.
 */
export function readerMoved(top: number, floor: number, observedTop: number): boolean {
  return Math.abs(top - Math.min(observedTop, floor)) > 0.5;
}

/** Row top relative to the scrollport box — a reflow-resistant anchor value. */
export function flowTop(row: { getBoundingClientRect(): { top: number } }, scrollport: { getBoundingClientRect(): { top: number } }): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
}

/**
 * The row the reader is on: the first one whose bottom is still below the
 * viewport top (the harness `pagingAnchor` line). Kept so a prepend of older
 * blocks can re-anchor to the same row and leave the reading position intact.
 */
export function anchorRow<T extends { getBoundingClientRect(): { top: number; bottom: number } }>(
  rows: readonly T[],
  scrollport: { getBoundingClientRect(): { top: number } },
): T | null {
  const line = scrollport.getBoundingClientRect().top;
  for (const row of rows) {
    if (row.getBoundingClientRect().bottom > line) return row;
  }
  return rows[rows.length - 1] ?? null;
}

/** One row's identity + where it sat when the anchor was taken. */
export interface ScrollAnchor {
  key: string;
  top: number;
}

/**
 * Applied to the scrollport after a prepend: put the anchored row back where it
 * was. Returns the new scrollTop (the caller writes it and records the ledger).
 */
export function restoredTop(currentTop: number, rowTop: number, anchorTop: number): number {
  return currentTop + (rowTop - anchorTop);
}