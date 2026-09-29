/**
 * One anchored dropdown menu, ported from deepseek-harness
 * `ui-primitives/Menu.tsx` + `Menu.module.css` (c) 2026 DeepSeek — MIT
 * License: the card, the rows, and every way a keyboard or pointer touches
 * them, owned once here instead of per select.
 *
 * What the owner does: pass `items`, the `selectedId`, and a trigger as
 * `anchor`; the menu opens on the owner's `open`, reports picks through
 * `onSelect`, and closes itself on Escape / an outside pointerdown / a window
 * blur into an iframe (the only signal a pointerdown inside a cross-origin
 * iframe leaves).
 *
 * The interaction contract (the reference's, verbatim):
 *  - focus never moves on open — the trigger keeps it; the arrow keys walk the
 *    rows either way, resuming from where the walk last put focus, not from
 *    `document.activeElement` (a row that refused focus would otherwise
 *    re-enter at the near end on every press);
 *  - Escape closes and hands the keyboard back to the trigger — without a
 *    ring, because the close was automatic (`shell/focus.ts`);
 *  - Tab settles the focused row, Shift+Tab leaves like Escape, and Tab on the
 *    trigger enters the list; only a keyboard already on the trigger or inside
 *    the list is intercepted — Tab elsewhere keeps the browser's traversal;
 *  - selecting a row returns focus to the trigger once the rows unmount,
 *    unless the owner kept the menu open or moved focus itself;
 *  - a modal that owns the foreground (`shell/modal-layer.ts`) silences the
 *    whole map, so a menu behind a dialog cannot steal its Escape.
 *
 * Two reductions of the source, both because nothing here uses them: the list
 * is always portaled beside the page (every host on this surface lives inside
 * a scroll container that clips — the composer card, the settings options, the
 * sidebar section headers), and there are no submenus, shortcuts, footers, or
 * danger rows. One addition: the preferred side flips to the other side of the
 * trigger when it cannot fit, so one select serves the composer's foot
 * (opens above) and the settings rows (open below) alike.
 *
 * The card's fill and blur are not here either: they are the shared
 * `shell/MenuSurface` layer, so this sheet carries geometry, elevation and ink
 * only and the theme keeps owning the material.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { focusWithoutRing } from './focus.js';
import { observeComposition } from './keyboard-composition.js';
import { isBehindModal } from './modal-layer.js';
import { isOptionIndex, stepOptionIndex } from './menu-nav.js';
import { MenuSurface } from './MenuSurface.js';
import { CheckIcon } from '../icons.js';
import css from './Menu.module.css';

/** One selectable row. */
export interface MenuItem {
  id: string;
  label: ReactNode;
  /** Leading glyph (the permission shield set, say). */
  icon?: ReactNode;
  /** Native tooltip (a raw id, when the label is a display name). */
  title?: string | undefined;
  disabled?: boolean;
}

/** Unplaced card: hidden, laid out at a fixed origin so the measure pass has real offsets. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 };

/** Safe distance kept between the card and the viewport edges (the source's portal margin). */
const VIEWPORT_MARGIN = 12;

/** Gap between the trigger's edge and the card (the source's 4px inset). */
const TRIGGER_GAP = 4;

export interface MenuProps {
  /** Whether the card is showing (owner-controlled). */
  open: boolean;
  /** The card's accessible name (`role="menu"`'s label). */
  label: string;
  /** Selectable rows, in display order. */
  items: readonly MenuItem[];
  /** The row that carries the trailing check. */
  selectedId?: string | undefined;
  /** Row activation (click, Enter, or Tab on the focused row). */
  onSelect?: (id: string) => void;
  /** Called on Escape, an outside pointerdown, or an iframe-taking blur. */
  onClose: () => void;
  /** Preferred side of the trigger; flips when that side cannot fit. */
  side?: 'below' | 'above';
  /** Which trigger edge the card aligns to. */
  align?: 'start' | 'end';
  /** Extra class on the card (a consumer's min-width, say). */
  listClassName?: string | undefined;
  /** The trigger control, rendered in place inside the menu's wrapper. */
  anchor: ReactNode;
}

/**
 * Render the trigger and, while open, its portaled card.
 * @param props - see MenuProps.
 * @returns the anchor wrapper with the conditional list.
 */
export function Menu({
  open, label, items, selectedId, onSelect, onClose, side = 'below', align = 'start', listClassName, anchor,
}: MenuProps): JSX.Element {
  const rootRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Index the arrow walk last focused, the resume point when focus left the rows. */
  const walkIndex = useRef<number | null>(null);
  /**
   * The control that had the keyboard when this menu opened — its own trigger.
   * Closing hands the keyboard back to it; an anchor that wrapped several
   * controls could not be asked for it by position.
   */
  const triggerRef = useRef<HTMLElement | null>(null);
  const selectingWithTab = useRef(false);
  const [fixedPos, setFixedPos] = useState<CSSProperties | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  /**
   * Hand the keyboard back to the trigger that opened the menu — or, when the
   * anchor never held it, to the anchor's first button. Focus left on a removed
   * row otherwise falls to the page body, where the next Tab restarts from the
   * top of the page.
   * @param navigation - whether explicit keyboard traversal should retain its focus indicator.
   */
  const refocusAnchor = (navigation = false): void => {
    const trigger = triggerRef.current;
    const candidate = trigger !== null && document.contains(trigger) && !(trigger as HTMLButtonElement).disabled
      ? trigger
      : rootRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? null;
    if (candidate === null) return;
    if (navigation) candidate.focus();
    else focusWithoutRing(candidate);
  };

  /**
   * Post-selection focus, for the path where the rows unmount with the list.
   * A selection whose owner keeps the menu open is left alone, and so is an
   * owner that moved focus itself: only a keyboard left on the closing list
   * (or on the body its removal produced) comes back to the trigger.
   */
  const refocusAfterSelection = (): void => {
    const navigation = selectingWithTab.current;
    queueMicrotask(() => {
      if (openRef.current) return;
      const active = document.activeElement;
      if (active === null || active === document.body || listRef.current?.contains(active) === true) refocusAnchor(navigation);
    });
  };

  // Opening remembers where the keyboard was, so closing can hand it back to
  // that control. Declared before the placement effect reads nothing of it —
  // order only matters against focus moves the open itself causes.
  useEffect(() => {
    if (!open) {
      triggerRef.current = null;
      return;
    }
    const active = document.activeElement;
    triggerRef.current = active instanceof HTMLElement && rootRef.current?.contains(active) === true ? active : null;
  }, [open]);

  // Portal placement: fixed-position the card from the anchor rect before
  // paint; track the anchor while open (capture-phase scroll catches nested
  // panes; a rAF loop catches a host that moves without either). The first run
  // measures the hidden pre-render (same commit as `open`), so clamping and
  // flipping use real dimensions before anything paints — no visible jump from
  // a zero-size first guess.
  useLayoutEffect(() => {
    if (!open) {
      setFixedPos(null);
      return;
    }
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const card = listRef.current;
      const width = card?.offsetWidth ?? 0;
      const height = card?.offsetHeight ?? 0;
      // Preferred side first; a card that does not fit there flips to the other
      // edge of the trigger before clamping, because a clamped card would cover
      // the row it belongs to.
      const roomAbove = rect.top - VIEWPORT_MARGIN;
      const roomBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const wanted = side === 'below' ? roomBelow : roomAbove;
      const other = side === 'below' ? roomAbove : roomBelow;
      const flipped = height > wanted && other > wanted;
      const below = (side === 'below') !== flipped;
      let x = align === 'end' ? rect.right - width : rect.left;
      let y = below ? rect.bottom + TRIGGER_GAP : rect.top - TRIGGER_GAP - height;
      if (width > 0) x = Math.min(Math.max(x, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN);
      if (height > 0) y = Math.min(Math.max(y, VIEWPORT_MARGIN), window.innerHeight - height - VIEWPORT_MARGIN);
      setFixedPos((current) => current !== null && current.left === x && current.top === y ? current : { left: x, top: y });
    };
    place();
    const track = (): void => {
      place();
      frame = requestAnimationFrame(track);
    };
    let frame = requestAnimationFrame(track);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, side, align]);

  // The keyboard map and the dismissal rules, bound while open. The listeners
  // read the owner through refs, so a consumer that re-creates its callbacks
  // per render does not re-bind them.
  useEffect(() => {
    if (!open) return;
    const composition = observeComposition(document);
    const onPointerDown = (e: PointerEvent): void => {
      if (!(e.target instanceof Node)) return;
      // The portaled card is outside the anchor subtree; check both.
      if (rootRef.current?.contains(e.target) === true) return;
      if (listRef.current?.contains(e.target) === true) return;
      closeRef.current();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (composition.guards(e) || isBehindModal(rootRef.current) || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      // Where the keyboard is, computed once: the menu owns it when it holds a
      // row or sits on its trigger.
      const focused = document.activeElement;
      const insideList = listRef.current?.contains(focused) === true;
      const anchored = rootRef.current?.contains(focused) === true || insideList;
      if (e.key === 'Escape' && !e.shiftKey) {
        // The preventDefault is what the modal layer underneath reads as
        // "mine": the press closes the menu and the dialog stays.
        e.preventDefault();
        if (e.repeat) return;
        closeRef.current();
        if (anchored) refocusAnchor();
        return;
      }
      if (e.key === 'Tab') {
        const list = listRef.current;
        if (list === null || !anchored) return;
        if (e.shiftKey) {
          e.preventDefault();
          closeRef.current();
          refocusAnchor(true);
          return;
        }
        // Tab settles the row it is on; from the trigger it enters the list.
        if (insideList) {
          if (focused instanceof Element && focused.getAttribute('role') === 'menuitem') {
            e.preventDefault();
            selectingWithTab.current = true;
            try { (focused as HTMLElement).click(); }
            finally { selectingWithTab.current = false; }
          }
          return;
        }
        const row = list.querySelector<HTMLButtonElement>('button:not(:disabled)');
        if (row === null) return;
        e.preventDefault();
        row.focus();
        walkIndex.current = 0;
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const list = listRef.current;
      if (list === null || !anchored) return;
      const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (buttons.length === 0) return;
      const index = buttons.indexOf(focused as HTMLButtonElement);
      const from = index >= 0 ? index : walkIndex.current;
      const next = e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : stepOptionIndex(from ?? -1, buttons.length, e.key === 'ArrowDown' ? 1 : -1);
      if (!isOptionIndex(next, buttons.length)) return;
      e.preventDefault();
      walkIndex.current = next;
      buttons[next]?.focus();
    };
    // A pointerdown inside a cross-origin iframe never reaches this document;
    // the focus move it causes blurs the window instead. Only that case
    // closes: an app or tab switch leaves the document's focus where it was.
    const onWindowBlur = (): void => {
      if (document.activeElement instanceof HTMLIFrameElement) closeRef.current();
    };
    const onEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onKeyDown(event); };
    const onOtherKey = (event: KeyboardEvent): void => { if (event.key !== 'Escape') onKeyDown(event); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onOtherKey);
    document.addEventListener('keydown', onEscape, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      composition.dispose();
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onOtherKey);
      document.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [open]);

  const renderItem = (item: MenuItem): JSX.Element => {
    const selected = item.id === selectedId;
    return (
      <div key={item.id} className={css.itemWrap}>
        <button
          type="button"
          role="menuitem"
          className={css.item}
          disabled={item.disabled}
          aria-current={selected ? 'true' : undefined}
          title={item.title}
          onClick={() => { onSelect?.(item.id); }}
        >
          {item.icon !== undefined && <span className={css.itemIcon} aria-hidden>{item.icon}</span>}
          <span className={css.itemLabel}>{item.label}</span>
          {selected && <span className={css.check} aria-hidden><CheckIcon /></span>}
        </button>
      </div>
    );
  };

  return (
    <span ref={rootRef} className={css.root}>
      {anchor}
      {open && createPortal(
        <MenuSurface
          ref={listRef}
          className={listClassName === undefined ? css.list : `${css.list} ${listClassName}`}
          style={fixedPos ?? MEASURE_STYLE}
          role="menu"
          aria-label={label}
          // React portals bubble synthetic events through the REACT tree, so a
          // row click must not re-fire the host around the anchor; this bubble
          // is also where the post-selection focus return is decided, after the
          // row's own handler ran.
          onClick={(e) => {
            e.stopPropagation();
            if (e.target instanceof Element && e.target.closest('button[role="menuitem"]') !== null) refocusAfterSelection();
          }}
        >
          <div className={css.viewport}>{items.map(renderItem)}</div>
        </MenuSurface>,
        document.body,
      )}
    </span>
  );
}
