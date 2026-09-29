/**
 * Hover and focus tooltips, ported from deepseek-harness
 * `ui-primitives/Tooltip.tsx` + `Tooltip.module.css` (c) 2026 DeepSeek — MIT
 * License. It exists here because a native `title` attribute is hover-only:
 * it never appears for a keyboard user and is not announced from the control
 * that owns it.
 *
 * What the contract keeps from the source, verbatim:
 *  - hover and focus are independent triggers — the bubble withdraws only
 *    after BOTH clear, so hovering away from a focused anchor does not drop it;
 *  - focus raises the bubble immediately while hover obeys `delayMs` (a
 *    pointer sweeping a row of icon controls must not flash a bubble per row);
 *  - focus arriving from a pointer (`pointerModality()`) never raises it — the
 *    click that focused the control is not a request to read its label;
 *  - activating the anchor dismisses the bubble, because the action usually
 *    relabels it (the approval card's kind chip is the case here);
 *  - the bubble stays hidden until its own laid-out size is known, then flips
 *    between `bottom` and `top` when the preferred side cannot fit and clamps
 *    into the viewport with a 12px margin;
 *  - disabling mid-hover drops a visible bubble (no `mouseleave` fires).
 *
 * Two deltas from the source:
 *  - the anchor is wired to the bubble with `aria-describedby` while the
 *    bubble is showing. The source is not: it clones an anchor that already
 *    carries an `aria-label`. This component replaces `title` attributes, and
 *    dropping `title` without naming the bubble would be a net accessibility
 *    loss for the readers that used it.
 *  - no nested-tooltip suppression channel and no `shortcutKeys` row: this
 *    surface has no hover card wrapping a tooltip and no keycap vocabulary.
 */
import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEventHandler, MouseEventHandler, MutableRefObject, ReactElement, Ref } from 'react';
import { createPortal } from 'react-dom';
import { pointerModality } from './input-modality.js';
import css from './Tooltip.module.css';

/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'bottom' | 'top';

/** Props this component injects into its anchor; the anchor's own handlers run first. */
interface AnchorProps {
  ref?: Ref<HTMLElement> | undefined;
  onMouseEnter?: MouseEventHandler | undefined;
  onMouseLeave?: MouseEventHandler | undefined;
  onClick?: MouseEventHandler | undefined;
  onFocus?: FocusEventHandler | undefined;
  onBlur?: FocusEventHandler | undefined;
  'aria-describedby'?: string | undefined;
}

/** Safe distance kept between the bubble and the viewport edges. */
const EDGE_MARGIN = 12;

export interface TooltipProps {
  /** Bubble text; a resolver runs only while the bubble is measured. */
  label: string | (() => string);
  /** Placement relative to the anchor (default `right`). */
  side?: TooltipSide;
  /** Anchor edge a `bottom`/`top` bubble aligns to. Ignored for `right`. */
  align?: 'center' | 'end';
  /** Hover delay in ms; keyboard focus stays immediate. */
  delayMs?: number;
  /** Anchor-to-bubble distance for `bottom`/`top` (default 8). Ignored for `right`. */
  gap?: number;
  /** Suppress the bubble while true; the anchor renders identically either way. */
  disabled?: boolean;
  /** Render the bubble under `document.body` when an ancestor clips. */
  portal?: boolean;
  /** A single anchor element; its own ref and handlers are preserved. */
  children: ReactElement<AnchorProps>;
}

/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props - see TooltipProps.
 * @returns the cloned anchor plus the bubble while it is showing.
 */
export function Tooltip({
  label,
  side = 'right',
  align = 'center',
  delayMs = 0,
  gap = 8,
  disabled = false,
  portal = false,
  children,
}: TooltipProps): JSX.Element {
  const anchor = useRef<HTMLElement | null>(null);
  // React 18 keeps an element's ref outside props; forward it here so wrapping
  // an anchor in a tooltip never severs the owner's own ref.
  const childRef = (children as ReactElement<AnchorProps> & { ref?: Ref<HTMLElement> }).ref;
  const mergedRef = useCallback((element: HTMLElement | null): void => {
    anchor.current = element;
    if (typeof childRef === 'function') childRef(element);
    else if (childRef != null) (childRef as MutableRefObject<HTMLElement | null>).current = element;
  }, [childRef]);

  // The anchor's edges rather than final coordinates: a vertical flip has to
  // re-derive the bubble's own top from the opposite edge.
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null);
  const bubble = useRef<HTMLSpanElement | null>(null);
  const bubbleId = useId();
  const resolvedLabel = pos === null ? null : typeof label === 'function' ? label() : label;
  // Hover and focus are independent triggers: the bubble hides only after BOTH
  // clear (hovering away from a focused anchor must not drop it).
  const triggers = useRef({ hover: false, focus: false });
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = pos !== null && !disabled;

  // ResizeObserver supplies the laid-out border box; fitting never reads
  // geometry after a position write and never needs a React commit to flip.
  useEffect(() => {
    const element = bubble.current;
    if (pos === null || !visible || element === null) return;
    let size: ResizeObserverSize | undefined;
    let placement = side;
    const fit = (): void => {
      if (size === undefined) return;
      const { inlineSize: width, blockSize: height } = size;
      const offset = side === 'right' ? 0 : align === 'end' ? width : width / 2;
      const left = Math.max(EDGE_MARGIN, Math.min(pos.x - offset, window.innerWidth - EDGE_MARGIN - width));
      const fitsBelow = pos.bottom + gap + height <= window.innerHeight - EDGE_MARGIN;
      const fitsAbove = pos.top - gap - height >= EDGE_MARGIN;
      if (placement === 'bottom' && !fitsBelow && fitsAbove) placement = 'top';
      else if (placement === 'top' && !fitsAbove && fitsBelow) placement = 'bottom';
      element.style.left = `${left + offset}px`;
      element.style.top = `${placement === 'right'
        ? (pos.top + pos.bottom) / 2
        : placement === 'top' ? pos.top - gap : pos.bottom + gap}px`;
      element.dataset.side = placement;
      element.style.visibility = 'visible';
    };
    const observer = new ResizeObserver((entries) => {
      size = entries[0]?.borderBoxSize[0];
      fit();
    });
    observer.observe(element, { box: 'border-box' });
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [align, gap, pos, side, visible]);

  const cancelShow = useCallback((): void => {
    if (showTimer.current === null) return;
    clearTimeout(showTimer.current);
    showTimer.current = null;
  }, []);
  // Disabling mid-hover (the approval card locks once answered) must drop an
  // already-visible bubble: no mouseleave fires for a state change.
  useEffect(() => {
    if (!disabled) return cancelShow;
    cancelShow();
    triggers.current = { hover: false, focus: false };
    setPos(null);
    return cancelShow;
  }, [cancelShow, disabled]);

  const withdraw = (): void => { setPos(null); };

  const show = (): void => {
    if (disabled) return;
    const element = anchor.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    setPos({
      x: side === 'right' ? rect.right + 10 : align === 'end' ? rect.right : rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom,
    });
  };
  const showAfterHoverDelay = (): void => {
    cancelShow();
    if (delayMs <= 0) {
      show();
      return;
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      show();
    }, delayMs);
  };
  const hide = (): void => {
    cancelShow();
    if (!triggers.current.hover && !triggers.current.focus) withdraw();
  };

  const content = visible && (
    <span
      ref={bubble}
      id={bubbleId}
      className={css.bubble}
      data-side={side}
      data-portal={portal || undefined}
      data-align={align}
      style={{ left: pos.x, top: 0, visibility: 'hidden' }}
      role="tooltip"
    >
      <span className={css.label}>{resolvedLabel}</span>
    </span>
  );

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        'aria-describedby': visible ? bubbleId : undefined,
        onMouseEnter: (event) => {
          children.props.onMouseEnter?.(event);
          triggers.current.hover = true;
          showAfterHoverDelay();
        },
        onMouseLeave: (event) => {
          children.props.onMouseLeave?.(event);
          triggers.current.hover = false;
          cancelShow();
          withdraw();
        },
        onClick: (event) => {
          children.props.onClick?.(event);
          triggers.current.focus = false;
          cancelShow();
          withdraw();
        },
        onFocus: (event) => {
          children.props.onFocus?.(event);
          // A pointer that focused the control did not ask to read its label.
          if (pointerModality()) return;
          triggers.current.focus = true;
          cancelShow();
          show();
        },
        onBlur: (event) => {
          children.props.onBlur?.(event);
          triggers.current.focus = false;
          hide();
        },
      })}
      {portal ? (content !== false && createPortal(content, document.body)) : content}
    </>
  );
}
