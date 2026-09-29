/**
 * The attachment rail's decisions, as pure functions — the input side of
 * `AttachmentRail.tsx`.
 *
 * Ported from deepseek-harness `ui-attachment/src/AttachmentRail.tsx` (MIT): the
 * rail pans sideways with its scrollbar hidden, its edge arrows are recomputed
 * from scroll geometry, a wheel over it becomes a horizontal step, and a page
 * step keeps one card of context. Kept here so the arithmetic is asserted
 * without a DOM.
 */

/**
 * Approximate pixels per wheel step for `deltaMode` LINE events (Firefox notch
 * wheels report lines, not pixels).
 */
export const WHEEL_LINE_PX = 16;

/** A fast wheel's vertical delta is clamped to this many pixels per tick. */
export const WHEEL_TICK_MAX_PX = 60;

/** One page step keeps this much of the previous view as context. */
export const PAGE_CONTEXT_PX = 64;
/** …and never moves less than this, so a narrow rail still pages usefully. */
export const PAGE_MIN_PX = 200;

/** Which edges the rail can still scroll toward. */
export interface RailEdges {
  /** The rail is scrolled away from its start. */
  left: boolean;
  /** The rail is scrolled away from its end. */
  right: boolean;
}

/**
 * Recompute the edge arrows from one scroll reading.
 *
 * The 1px slack matters: engines report fractional scroll positions at the
 * edges, so an exact comparison would leave an arrow on when the rail is
 * already at its end.
 * @param scrollLeft - the rail's current horizontal offset.
 * @param scrollWidth - the rail's full content width.
 * @param clientWidth - the rail's visible width.
 * @returns which arrows to render.
 */
export function railEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): RailEdges {
  return {
    left: scrollLeft > 1,
    right: scrollLeft < scrollWidth - clientWidth - 1,
  };
}

/**
 * One arrow click's travel: a viewport minus a card, floored so a narrow rail
 * still pages a useful distance.
 * @param clientWidth - the rail's visible width.
 * @returns the distance to scroll, in px.
 */
export function railPageDistance(clientWidth: number): number {
  return Math.max(clientWidth - PAGE_CONTEXT_PX, PAGE_MIN_PX);
}

/**
 * The horizontal distance one wheel event should pan the rail, or null when the
 * event carries no vertical component and the native horizontal scroll stands.
 *
 * A wheel delta arrives in the event's own unit — pixels, lines (Firefox) or
 * pages — so it is normalized before the per-tick clamp that keeps a fast wheel
 * followable. A diagonal trackpad pan keeps its horizontal intent.
 * @param event - the wheel's deltas and their unit.
 * @param clientWidth - the rail's visible width (the PAGE unit's scale).
 * @returns the distance to scroll, in px, or null to leave the event alone.
 */
export function railWheelStep(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  clientWidth: number,
): number | null {
  if (event.deltaY === 0) return null;
  const scale = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? clientWidth : 1;
  if (event.deltaX !== 0) return event.deltaX * scale;
  return Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * scale, WHEEL_TICK_MAX_PX);
}
