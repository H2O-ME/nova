/**
 * The draft-attachment rail, ported from deepseek-harness
 * `ui-attachment/src/AttachmentRail.tsx` + `AttachmentRail.module.css` (c) 2026
 * DeepSeek — MIT License: a scrollbar-less horizontal rail paged by edge
 * arrows, with its items at their intrinsic size (a FileCard is 240 × 64) and a
 * vertical wheel converted to a horizontal pan.
 *
 * The reference's behaviours, one for one: the arrows are recomputed from
 * scroll geometry on scroll, on an item-count change, and on a rail resize (a
 * ResizeObserver on the rail itself — the rail follows the composer, which
 * resizes with sidebars and panels, not only the window); a newly added item is
 * revealed at the rail's end while a rail that MOUNTS over an existing draft
 * keeps its start position; and the wheel listener is attached non-passively
 * because React's own root listener is passive, so without `preventDefault` a
 * vertical wheel would also scroll the conversation behind the composer.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons.js';
import { railEdges, railPageDistance, railWheelStep, type RailEdges } from './attachment-rail.js';
import { cx } from './cx.js';
import css from './AttachmentRail.module.css';

/** One rail item: only its identity is the rail's business. */
export interface AttachmentRailItem {
  /** Stable identity for the React key. */
  id: string;
}

export interface AttachmentRailLabels {
  /** The rail group's accessible name. */
  group: string;
  /** The left arrow's accessible name. */
  scrollLeft: string;
  /** The right arrow's accessible name. */
  scrollRight: string;
}

/** Smooth paging unless the reader asked for reduced motion. */
function pageBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

export interface AttachmentRailProps<T extends AttachmentRailItem> {
  /** The attachments, in draft order. */
  items: readonly T[];
  labels: AttachmentRailLabels;
  /** Render one item's own card. */
  renderItem: (item: T) => ReactNode;
}

export function AttachmentRail<T extends AttachmentRailItem>({
  items,
  labels,
  renderItem,
}: AttachmentRailProps<T>): JSX.Element {
  const railRef = useRef<HTMLDivElement | null>(null);
  // null marks the first layout pass: a rail mounting over an existing draft is
  // initial display, not growth, and must not jump to the end.
  const countRef = useRef<number | null>(null);
  const [edges, setEdges] = useState<RailEdges>({ left: false, right: false });
  const updateEdges = useCallback((): void => {
    const el = railRef.current;
    if (el === null) return;
    const next = railEdges(el.scrollLeft, el.scrollWidth, el.clientWidth);
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);
  useLayoutEffect(() => {
    const grew = countRef.current !== null && items.length > countRef.current;
    countRef.current = items.length;
    const el = railRef.current;
    if (el === null) return;
    // A newly added attachment lands at the rail's end: reveal it.
    if (grew) el.scrollLeft = el.scrollWidth - el.clientWidth;
    updateEdges();
  }, [items.length, updateEdges]);
  useEffect(() => {
    const el = railRef.current;
    if (el === null) return;
    let disconnect = (): void => {};
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateEdges);
      observer.observe(el);
      disconnect = () => { observer.disconnect(); };
    }
    const onWheel = (event: globalThis.WheelEvent): void => {
      const step = railWheelStep(event, el.clientWidth);
      if (step === null) return;
      event.preventDefault();
      el.scrollBy({ left: step, behavior: 'auto' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [updateEdges]);
  const page = (direction: -1 | 1): void => {
    const el = railRef.current;
    if (el === null) return;
    el.scrollBy({ left: direction * railPageDistance(el.clientWidth), behavior: pageBehavior() });
  };
  return (
    <div className={css.root}>
      {edges.left && (
        <button
          type="button"
          className={cx(css.arrow, css.arrowLeft)}
          aria-label={labels.scrollLeft}
          onClick={() => { page(-1); }}
        >
          <ChevronLeftIcon />
        </button>
      )}
      <div
        ref={railRef}
        className={css.rail}
        role="group"
        aria-label={labels.group}
        onScroll={updateEdges}
      >
        {items.map((item) => (
          <div key={item.id} className={css.item}>{renderItem(item)}</div>
        ))}
      </div>
      {edges.right && (
        <button
          type="button"
          className={cx(css.arrow, css.arrowRight)}
          aria-label={labels.scrollRight}
          onClick={() => { page(1); }}
        >
          <ChevronRightIcon />
        </button>
      )}
    </div>
  );
}
