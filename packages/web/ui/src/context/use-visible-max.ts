/**
 * The 自适应 scale's measure: the peak of the bars currently inside the plot's
 * viewport, kept in step with the scroll (dsh's own toggle — a spike scrolled
 * out of reach must not flatten the bars on screen).
 *
 * This is only the DOM binding for `visibleMax` (trend-geometry.ts): the
 * arithmetic is pure and asserted there; here lives WHEN to re-read — the
 * scroller's own scroll event, a pane resize, and every commit that can move
 * the window (the toggle flipping on, the log growing). The state write bails
 * out when the peak is unchanged, so scrolling across a stretch of equal bars
 * re-renders nothing.
 *
 * Measured in `useEffect`, not a layout effect: the server renderer runs no
 * effects at all, and a chart that settles a frame after paint is what the
 * card's own entrance animation already does.
 */
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ContextPoint } from '../types.js';
import { visibleMax } from './trend-geometry.js';

export function useVisibleMax(
  scroller: RefObject<HTMLDivElement | null>,
  points: readonly ContextPoint[],
  enabled: boolean,
): number | undefined {
  const [max, setMax] = useState<number | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el === null || !enabled) return undefined;
    const measure = (): void => {
      setMax((prev) => {
        const next = visibleMax(points, el.scrollLeft, el.clientWidth);
        return next === prev ? prev : next;
      });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [scroller, points, enabled]);
  return enabled ? max ?? undefined : undefined;
}
