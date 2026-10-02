/**
 * The scroll-edge observer for a capped body — port of the harness
 * `ui-chat`'s `ChatGroupSeat` fade measure (c) 2026 DeepSeek — MIT License:
 * which of the two ends can still scroll, so the gradient fades mark 「还有更多」
 * rather than 「到头了」. Both signals move on scroll AND on content growth
 * (an arriving row changes what is clipped), hence the ResizeObserver. An
 * inactive group (uncapped, hidden, or live) has no measurable end and never
 * measures.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

export interface CappedEdges {
  /** Attach to the scrolling body. */
  bodyRef: RefObject<HTMLDivElement>;
  /** The top end is clipped: the reader can still scroll up. */
  up: boolean;
  /** The bottom end is clipped: the reader can still scroll down. */
  down: boolean;
}

/**
 * @param active - measure at all (a capped, visible group).
 * @param content - the body's children; growth re-measures.
 * @returns the body ref and its live scroll edges.
 */
export function useCappedEdges(active: boolean, content: ReactNode): CappedEdges {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ up: false, down: false });
  const measure = useCallback((): void => {
    const box = bodyRef.current;
    if (box === null) return;
    setEdges({
      up: box.scrollTop > 1,
      down: box.scrollTop + box.clientHeight < box.scrollHeight - 1,
    });
  }, []);
  useEffect(() => {
    const box = bodyRef.current;
    if (box === null || !active) return;
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      box.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure, active, content]);
  return { bodyRef, up: edges.up, down: edges.down };
}
