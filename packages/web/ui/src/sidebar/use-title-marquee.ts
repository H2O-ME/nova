/**
 * Hover marquee for a session row's clipped title.
 * Ported from deepseek-harness `ui-workspace/src/client/rows/Rows.tsx`
 * (`useTitleMarquee` / `placeTitle` / `restTitle`), (c) 2026 DeepSeek — MIT
 * License.
 *
 * A row's title is one line with an ellipsis, so a long title (a fork's
 * incremented name, say) hides its own distinguishing tail exactly when the
 * pointer is on the row asking which session it is. Hovering crawls the title
 * at a constant speed until its far edge is in view and rests it there; leaving
 * returns it to the start in one step, because the resting ellipsis and the
 * narrowed cell would otherwise meet the text while it travelled back.
 *
 * The motion is scripted frame by frame rather than left to `scroll-behavior`,
 * and both clipping edges fade in over 12px instead of hard-cutting a
 * character — the sheet reads the `data-scrolled` / `data-clipped` hooks this
 * hook publishes. Reduced motion jumps to the far edge instead of crawling.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

/** Overflow a title keeps still for: moving a barely-clipped line reads as jitter. */
export const MIN_TITLE_REVEAL_PX = 8;
/** Crawl speed in CSS pixels per millisecond (the reference's 30px/s). */
export const TITLE_MARQUEE_PX_PER_MS = 0.03;

/**
 * Place the title's scroll offset and publish the sheet's fade hooks.
 * @param title - the row's clipping title element.
 * @param left - scroll offset in CSS pixels.
 * @param range - the title's maximum scroll offset in CSS pixels.
 */
function placeTitle(title: HTMLSpanElement, left: number, range: number): void {
  // jsdom implements no scrollTo; the direct assignment is instant there too,
  // so both paths land on the same position.
  if (typeof title.scrollTo === 'function') title.scrollTo({ left, behavior: 'instant' });
  else title.scrollLeft = left;
  if (left > 0) title.dataset['scrolled'] = '';
  else delete title.dataset['scrolled'];
  if (left < range) title.dataset['clipped'] = '';
  else delete title.dataset['clipped'];
}

/**
 * Return the title to rest: at the start with both fade hooks off, so the
 * resting ellipsis renders at full strength.
 * @param title - the row's clipping title element.
 */
function restTitle(title: HTMLSpanElement): void {
  if (typeof title.scrollTo === 'function') title.scrollTo({ left: 0, behavior: 'instant' });
  else title.scrollLeft = 0;
  delete title.dataset['scrolled'];
  delete title.dataset['clipped'];
}

/** Whether the environment asks for reduced motion (absent in a DOM-less lane). */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Stable pointer enter/leave handlers that marquee a too-long title.
 * @param title - ref to the row's clipping title element.
 * @returns the handlers to spread onto the row.
 */
export function useTitleMarquee(title: RefObject<HTMLSpanElement | null>): {
  enter: () => void;
  leave: () => void;
} {
  const frame = useRef(0);
  // No `ref.current === null` guard inside the handlers: the title span renders
  // unconditionally, so the ref is set by the time either handler can run.
  useEffect(() => () => { cancelAnimationFrame(frame.current); }, []);
  return useMemo(() => ({
    enter: (): void => {
      const element = title.current;
      if (element === null) return;
      const range = element.scrollWidth - element.clientWidth;
      if (range <= MIN_TITLE_REVEAL_PX) return;
      if (prefersReducedMotion()) {
        placeTitle(element, range, range);
        return;
      }
      cancelAnimationFrame(frame.current);
      let previous: number | undefined;
      let position = 0;
      const step = (now: DOMHighResTimeStamp): void => {
        // The first frame only establishes the baseline: charging it for the
        // time since `enter` would jump the title on a slow first paint.
        position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS;
        previous = now;
        placeTitle(element, Math.min(position, range), range);
        if (position < range) frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    },
    leave: (): void => {
      cancelAnimationFrame(frame.current);
      const element = title.current;
      if (element === null) return;
      restTitle(element);
    },
  }), [title]);
}
