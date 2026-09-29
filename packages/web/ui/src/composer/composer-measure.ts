/**
 * The draft's height contract, ported from deepseek-harness ui-conversation
 * (MIT): the harness caps the draft scrollport at 14 lines × 24px = 336px
 * (`--dsh-composer-text-max-height` — InputBar.module.css `.scroll` reads it,
 * ConversationRoot.module.css `.composerSeat` declares it) and floors a docked
 * draft at one 24px line plus its 4px top pad (36px, `.input` min-height).
 *
 * The division of labour is the harness's, and it is load-bearing: the text
 * surface GROWS with its content, and the cap belongs to the scrollport around
 * it — "one scrollport, one text surface", so there is exactly one box that
 * scrolls (`InputBar.module.css .scroll`). A clamped inline height on the
 * surface itself would clip a long draft instead of scrolling it.
 *
 * The grow is DOM work (measure `scrollHeight` at height 0, write the value
 * back); what lives here is the arithmetic a test can pin.
 */

/** Lines the draft scrollport shows before it scrolls (figma Input 75:8208). */
export const TEXT_MAX_LINES = 14;
/** The line the cap is drawn from (InputBar `.card` line-height). */
export const TEXT_LINE_HEIGHT_PX = 24;
/** The cap itself: `--dsh-composer-text-max-height` in the sheet, one value. */
export const TEXT_MAX_PX = TEXT_MAX_LINES * TEXT_LINE_HEIGHT_PX;
/** Docked floor: one 24px line + the 4px top pad (`.input` min-height: 36px). */
export const TEXT_MIN_PX = 36;

/**
 * The height to write on the draft surface for one measurement.
 *
 * Unclamped on purpose (see the module doc): the surface hands its full content
 * height to the scrollport, which caps the visible box at `TEXT_MAX_PX`. A
 * non-finite measurement (a detached box reports 0, a hidden one can report NaN
 * through a scaled ancestor) falls back to the docked floor instead of writing
 * `height: NaNpx`, which no engine applies and which would leave the previous
 * draft's height in place.
 * @param contentHeight - the surface's measured content height, in px.
 * @returns the height to write back, in px.
 */
export function composerSurfaceHeight(contentHeight: number): number {
  if (!Number.isFinite(contentHeight)) return TEXT_MIN_PX;
  return Math.max(0, Math.round(contentHeight));
}

/**
 * Whether a wheel over the draft scrollport should be forwarded to the
 * conversation scroller (harness InputBar's wheel chaining): while the capped
 * box can still move in that direction the native scroll stays; only at the
 * box's own edge does the delta go on, so a short draft never traps the
 * gesture and a long draft stays scrollable.
 * @param state - the wheel's delta and the scrollport's own numbers.
 * @returns true when the conversation scroller should take the delta.
 */
export function chainsWheelToConversation(state: {
  deltaY: number;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  if (state.deltaY === 0) return false;
  const atTop = state.scrollTop <= 0;
  const atEnd = state.scrollTop + state.clientHeight >= state.scrollHeight - 1;
  if (state.deltaY < 0) return atTop;
  return atEnd;
}

/** Wheel deltaMode: the delta counts lines (Firefox's default). */
export const WHEEL_DELTA_LINE = 1;
/** Wheel deltaMode: the delta counts pages. */
export const WHEEL_DELTA_PAGE = 2;
/** Line height assumed when the scrollport reports no usable one. */
export const FALLBACK_WHEEL_LINE_PX = 16;

/**
 * One wheel event's vertical delta in scrollport pixels. A wheel delta arrives
 * in the event's own unit — pixels, lines (Firefox) or pages — so forwarding a
 * gesture to another scroller has to convert first; passing a line count
 * straight to `scrollBy` would move a whole 3px instead of ~48px. The caller
 * reads the two measurements off the target (a pure function cannot).
 * @param event - the wheel's delta and its unit.
 * @param metrics - the target's resolved line height and visible height, in px.
 * @returns the delta in pixels.
 */
export function wheelDeltaY(
  event: { deltaY: number; deltaMode: number },
  metrics: { lineHeight: number; clientHeight: number },
): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) {
    return event.deltaY * (Number.isFinite(metrics.lineHeight) && metrics.lineHeight > 0 ? metrics.lineHeight : FALLBACK_WHEEL_LINE_PX);
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE) return event.deltaY * metrics.clientHeight;
  return event.deltaY;
}

/** Height cap that fits the two headings and eight built-in command rows. */
export const MENU_MAX_HEIGHT = 400;

/**
 * The gap a bottom-anchored trigger menu keeps to the viewport top edge.
 *
 * 84px = the conversation header's own 76px block (`conversation/
 * SessionHeader.module.css`) plus 8px of air, which is the harness's
 * `MenuView` `TOP_MARGIN` for this exact seat. The primitive `Menu`'s 12px
 * would let a long `@` listing grow UP over the header and cover it, because
 * the menu is `position: absolute` — the header does not push it down.
 */
export const MENU_MARGIN = 84;

/**
 * Clamp a bottom-anchored overlay's height to the viewport (harness
 * `useAnchoredMaxHeight`): the overlay's bottom edge is laid out independent of
 * its height, so it grows upward and only the top edge can collide.
 * @param bottom - the overlay's laid-out bottom edge, in px from the viewport top.
 * @param cap - design max-height; the clamp never exceeds it.
 * @param margin - the gap kept to the viewport top edge.
 * @returns the max-height to apply, in px.
 */
export function menuMaxHeight(bottom: number, cap: number = MENU_MAX_HEIGHT, margin: number = MENU_MARGIN): number {
  if (!Number.isFinite(bottom)) return cap;
  return Math.min(cap, Math.max(0, bottom - margin));
}

/**
 * Whether a scrolled overlay can still move down: the trigger menu's overflow
 * hint renders while rows remain below the fold.
 * @param scrollTop - the viewport's scroll offset.
 * @param clientHeight - the viewport's visible height.
 * @param scrollHeight - the viewport's full content height.
 * @returns true while rows remain below the fold.
 */
export function menuOverflowBelow(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollTop + clientHeight < scrollHeight - 1;
}