/**
 * One portaled, trigger-anchored floating layer: placement and outside
 * dismissal, shared by every anchored menu this surface has (the composer's
 * model seat, the sidebar's view options).
 *
 * Why a portal at all: the cards live inside scroll containers that clip
 * (the sidebar's section header carries `overflow: hidden` for its collapse
 * animation; the composer card carries the column's own clips), so a menu
 * rendered in place would be cropped. Placement therefore follows the trigger
 * through `getBoundingClientRect`, on every scroll and resize while open.
 *
 * What stays with the consumer: the card's markup and styles, its keyboard
 * map (the model menu walks its rows with the arrow keys), and Escape (the
 * shell's layer stack owns that — `useEscapeToClose`).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject } from 'react';

/** Unplaced card: hidden, laid out at a fixed origin so the measure pass has real offsets. */
export const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 };

/** Safe distance kept between the card and the viewport edges (the harness Menu portal's margin). */
export const VIEWPORT_MARGIN = 12;

/** Which side of the trigger the card prefers. */
export type PopoverPlacement = 'above' | 'below';
/** Which trigger edge the card aligns to. */
export type PopoverAlign = 'start' | 'end';

export interface UseAnchoredPopoverOptions {
  /** Whether the card is mounted; a closed layer places nothing. */
  open: boolean;
  /** Called on a pointerdown outside both the trigger and the card. */
  onDismiss: () => void;
  /** Preferred side of the trigger (flipped when that side cannot fit). */
  placement?: PopoverPlacement;
  /** Trigger edge the card aligns to. */
  align?: PopoverAlign;
  /** Gap between the trigger's edge and the card, in px. */
  gap?: number;
  /**
   * Extra placement trigger, compared by identity: pass whatever async value
   * resizes the card (an arriving catalog), so it is re-measured on arrival.
   */
  remeasure?: unknown;
}

export interface AnchoredPopover {
  /** Attach to the card element (portaled to body). */
  cardRef: MutableRefObject<HTMLDivElement | null>;
  /** Inline style for the card: the placed position, or the hidden measure pass. */
  style: CSSProperties;
}

/**
 * Close one floating layer on a pointerdown outside it.
 *
 * The in-place panels (`ContextMeter`, `PermissionSelect`) and the portaled
 * cards (this module's own two menus) all need the same rule — "an event whose
 * target is inside any of my boxes is mine" — so it is written once here. The
 * listener lives only while the layer is open.
 * @param open - whether the layer is mounted.
 * @param inside - the boxes that count as inside (the trigger, then the layer).
 * @param onDismiss - called for a pointerdown outside all of them.
 */
export function useDismissOutside(
  open: boolean,
  inside: readonly MutableRefObject<HTMLElement | null>[],
  onDismiss: () => void,
): void {
  // Both the boxes and the callback are read through refs, so a consumer that
  // re-creates either one per render does not re-bind the document listener.
  const boxes = useRef(inside);
  boxes.current = inside;
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (boxes.current.some((box) => box.current?.contains(target) === true)) return;
      dismiss.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); };
  }, [open]);
}

/**
 * Place one card against its trigger and dismiss it on an outside pointerdown.
 *
 * The card mounts hidden at the origin for one frame (`MEASURE_STYLE`), so its
 * own size is real when the position is solved — a card measured at zero size
 * would be clamped as if it were empty.
 * @param anchor - the trigger element (the consumer's own ref).
 * @param options - see UseAnchoredPopoverOptions.
 * @returns the card's ref and inline style.
 */
export function useAnchoredPopover(
  anchor: MutableRefObject<HTMLElement | null>,
  { open, onDismiss, placement = 'above', align = 'end', gap = 8, remeasure }: UseAnchoredPopoverOptions,
): AnchoredPopover {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>(MEASURE_STYLE);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(MEASURE_STYLE);
      return;
    }
    const place = (): void => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const card = cardRef.current;
      const width = card?.offsetWidth ?? 0;
      const height = card?.offsetHeight ?? 0;
      // Preferred side first; a card that does not fit there flips to the other
      // edge of the trigger before clamping, because a clamped card would cover
      // the row it belongs to.
      const roomAbove = rect.top - VIEWPORT_MARGIN;
      const roomBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const wanted = placement === 'above' ? roomAbove : roomBelow;
      const flipped = height > wanted && (placement === 'above' ? roomBelow : roomAbove) > wanted;
      const below = (placement === 'below') !== flipped;
      let x = align === 'end' ? rect.right - width : rect.left;
      let y = below ? rect.bottom + gap : rect.top - gap - height;
      if (width > 0) x = Math.min(Math.max(x, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN);
      if (height > 0) y = Math.min(Math.max(y, VIEWPORT_MARGIN), window.innerHeight - height - VIEWPORT_MARGIN);
      setStyle({ left: Math.round(x), top: Math.round(y) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchor, placement, align, gap, remeasure]);

  useDismissOutside(open, [anchor, cardRef], onDismiss);

  return { cardRef, style };
}