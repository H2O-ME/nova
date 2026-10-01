/**
 * The composer's trigger menu (`/` commands, `@` files), a visual port of
 * deepseek-harness `ui-input-trigger/src/client/MenuView.tsx` (MIT): the
 * overlay that opens ABOVE the input card, edge to edge with it, its rows
 * growing upward until the viewport's top edge clamps them.
 *
 * It is a shell with an API and no data source: our wire has no command or
 * reference catalog (the harness feeds this view from `InputTriggerService`,
 * fed in turn by every command and file provider in its tree), so nothing in
 * this surface can open it yet. What is ported is what a data source would
 * find on arrival — the card, the scrolling viewport, the section headings,
 * the row (icon, title, alias, description, the drill hint that names Tab as
 * the chevron's keyboard twin), the shared pointer highlight, and the two
 * runtime behaviors the sheet's comments call out: the viewport's top-edge
 * clamp (`useAnchoredMaxHeight`) and the overflow hint that appears while the
 * list can still move down.
 *
 * Not ported, because they belong to the multi-source directory pipeline this
 * surface has no analogue for: the breadcrumb header of a drilled source and the
 * pending-source skeleton rows. (The keyboard arbitration is NOT missing — the
 * composer bar owns it, and this view exposes the highlight through
 * `aria-activedescendant` so the listbox stays legible without owning focus.)
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DRILL_ARIA, DRILL_HINT, DRILL_KEY, MENU_LOADING } from './composer-text.js';
import { MENU_MAX_HEIGHT, menuMaxHeight, menuOverflowBelow } from './composer-measure.js';
import { ComposerCrumbs } from './ComposerCrumbs.js';
import { cx } from './cx.js';
import { ReferenceFileIcon, ReferenceFolderIcon } from './Icons.js';
import type { ReferenceCrumb } from './reference-crumbs.js';
import css from './ComposerMenu.module.css';

/**
 * One row's DOM id, derived from its listbox id and ordinal.
 *
 * `aria-activedescendant` points at a row by id, so the pair (listbox, row) has
 * to be expressible; deriving both from one value keeps them from drifting.
 * @param listboxId - the listbox element's id.
 * @param index - the row's ordinal in the list.
 * @returns the row's id.
 */
export function rowId(listboxId: string, index: number): string {
  return `${listboxId}-row-${String(index)}`;
}

/**
 * The id of the row the highlight is on, or undefined when none is.
 *
 * Undefined (rather than a dangling id) is deliberate: `aria-activedescendant`
 * naming an element that is not in the DOM is a worse answer than naming
 * nothing, and an empty or skeleton list has no row to point at.
 * @param listboxId - the listbox element's id.
 * @param items - the rows, in render order.
 * @returns the active row's id, or undefined.
 */
export function activeRowId(listboxId: string, items: readonly ComposerMenuItem[]): string | undefined {
  const index = items.findIndex((item) => item.active === true);
  return index < 0 ? undefined : rowId(listboxId, index);
}

/** One row of the trigger menu: a candidate the composer would insert. */
export interface ComposerMenuItem {
  id: string;
  label: string;
  /** The command's raw name beside a localized title (harness `.itemAlias`). */
  alias?: string;
  /** Right-aligned, ends at the same edge on every row. */
  description?: string;
  /** A heading rendered above the first item carrying it. */
  section?: string;
  /**
   * The row's glyph. A string names one of the reference domains (the harness
   * `MenuView` renders those itself); anything else is a ready element.
   */
  icon?: ReactNode | 'file' | 'folder';
  /** The shared highlight: pointer motion and keyboard moves park it here. */
  active?: boolean;
  /** A drillable row (a directory): shows the Tab hint and the chevron. */
  drill?: boolean;
}

export function ComposerMenu({
  items,
  groupTitle,
  ariaLabel,
  pending = false,
  listboxId,
  crumbs,
  onPick,
  onDrill,
  onCrumb,
  onHover,
  onDismiss,
}: {
  items: readonly ComposerMenuItem[];
  /** A heading for the whole group (skipped when rows carry sections). */
  groupTitle?: string;
  /** The listbox's accessible name. */
  ariaLabel: string;
  /**
   * The listing is still being fetched and no rows have arrived: the
   * reference's pending group renders two skeleton rows and NO empty-state
   * copy, because "nothing matched" and "not asked yet" are different answers.
   */
  pending?: boolean;
  /**
   * This listbox's DOM id. The textarea OWNS focus while the menu is open (the
   * combobox pattern — the draft keeps being typed), so the row the arrows have
   * parked on is invisible to assistive technology unless the control that holds
   * focus points at it. That pointer is `aria-activedescendant`, and it needs
   * this id plus one per row (see {@link rowId}).
   */
  listboxId?: string;
  /**
   * The drilled listing's breadcrumb trail, pinned above the viewport. It is
   * rendered only for a drill — a typed path keeps its context in the draft.
   */
  crumbs?: readonly ReferenceCrumb[];
  onPick?: (item: ComposerMenuItem) => void;
  onDrill?: (item: ComposerMenuItem) => void;
  /** A crumb before the current one was pressed: drill back to its directory. */
  onCrumb?: (crumb: ReferenceCrumb) => void;
  /** Pointer motion moved onto a row: park the shared highlight there. */
  onHover?: (item: ComposerMenuItem) => void;
  /** A pointer pressed outside the menu and outside the composer card. */
  onDismiss?: () => void;
}): JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState(MENU_MAX_HEIGHT);
  const [overflowBelow, setOverflowBelow] = useState(false);
  // The anchor moves when the composer grows or the query refines the list, so
  // the fit is re-measured on every item change; resize/scroll re-fit while
  // mounted.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el === null) return;
    const fit = (): void => { setMaxHeight(menuMaxHeight(el.getBoundingClientRect().bottom)); };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
  }, [items, pending]);
  const updateOverflow = useCallback(() => {
    const viewport = viewportRef.current;
    setOverflowBelow(viewport !== null
      && menuOverflowBelow(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight));
  }, []);
  useLayoutEffect(() => {
    updateOverflow();
  }, [items, pending, maxHeight, updateOverflow]);
  // Dismiss on a pointer outside the menu AND outside the composer card:
  // clicking the textarea or the bottom bar must not close the menu (the
  // reference's own rule). Captured on the document, because the card's own
  // controls stop propagation at pointerdown.
  useEffect(() => {
    if (onDismiss === undefined) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (listRef.current?.contains(event.target) === true) return;
      if (listRef.current?.closest('[data-composer-card]')?.contains(event.target) === true) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); };
  }, [onDismiss]);
  const sections = items.some((item) => item.section !== undefined);
  useEffect(() => {
    if (listRef.current === null) return;
    listRef.current.querySelector('[data-menu-active]')?.scrollIntoView({ block: 'nearest' });
  }, [items]);
  const skeleton = pending && items.length === 0;
  return (
    <div
      ref={listRef}
      className={css.menu}
      style={{ maxHeight }}
      data-trigger-menu=""
      data-overflow-below={overflowBelow || undefined}
    >
      {crumbs !== undefined && crumbs.length > 0 && (
        <ComposerCrumbs crumbs={crumbs} onCrumb={(crumb) => onCrumb?.(crumb)} />
      )}
      <div
        ref={viewportRef}
        id={listboxId}
        className={css.viewport}
        role="listbox"
        aria-label={ariaLabel}
        // The highlight the arrows parked on, as a reference to the row's own id.
        // Focus never leaves the textarea (the combobox pattern below), so
        // without this the active option exists only as a CSS class and an
        // assistive-technology user hears the list but not which row is armed —
        // `aria-selected` is not announced for a row that does not hold focus.
        aria-activedescendant={
          listboxId === undefined ? undefined : activeRowId(listboxId, items)
        }
        onScroll={updateOverflow}
      >
        {skeleton
          ? (
            <div role="status" aria-label={MENU_LOADING}>
              <div className={css.skeletonRow}><span className={css.skeletonBar} style={{ width: '32%' }} /></div>
              <div className={css.skeletonRow}><span className={css.skeletonBar} style={{ width: '48%' }} /></div>
            </div>
          )
          : items.length === 0
            ? null
            : (
              <>
                {groupTitle !== undefined && !sections && (
                  <div className={css.groupTitle} role="presentation">{groupTitle}</div>
                )}
                {items.map((item, index) => (
                  <Fragment key={item.id}>
                    {item.section !== undefined && item.section !== items[index - 1]?.section
                      ? <div className={css.sectionTitle} role="presentation">{item.section}</div>
                      : null}
                    <button
                      type="button"
                      role="option"
                      id={listboxId === undefined ? undefined : rowId(listboxId, index)}
                      aria-selected={item.active === true}
                      data-menu-active={item.active === true ? '' : undefined}
                      className={cx(css.item, item.active === true && css.active)}
                      // mousedown, not click: the textarea keeps focus (combobox
                      // pattern) — preventing default stops the focus steal, and the
                      // pick runs before any blur-driven teardown.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onPick?.(item);
                      }}
                      // mousemove, not mouseenter: real pointer motion moves the
                      // shared highlight; keyboard scrolling rows under a resting
                      // pointer must not steal it back.
                      onMouseMove={item.active === true ? undefined : () => { onHover?.(item) }}
                    >
                      {item.icon !== undefined && (
                        <span className={css.itemIcon} aria-hidden="true">
                          {item.icon === 'folder'
                            ? <ReferenceFolderIcon />
                            : item.icon === 'file'
                              ? <ReferenceFileIcon />
                              : item.icon}
                        </span>
                      )}
                      <span className={css.itemName}>{item.label}</span>
                      {item.alias !== undefined && <span className={css.itemAlias}>{item.alias}</span>}
                      {item.description !== undefined && <span className={css.itemDescription}>{item.description}</span>}
                      {item.drill === true && (
                        <span className={css.trailing}>
                          {/* Visual hint only: Tab drills the highlighted row (the
                              keyboard twin of the chevron, which owns the aria label). */}
                          <span className={css.drillHintText} aria-hidden="true">{DRILL_HINT}</span>
                          <kbd className={css.drillHint} aria-hidden="true">{DRILL_KEY}</kbd>
                          <span
                            role="button"
                            aria-label={DRILL_ARIA}
                            className={css.drill}
                            // mousedown so the composer keeps focus, same as the row;
                            // stopPropagation keeps the row's settling pick out of it.
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onDrill?.(item);
                            }}
                          >
                            <ChevronRight />
                          </span>
                        </span>
                      )}
                    </button>
                  </Fragment>
                ))}
              </>
            )}
      </div>
    </div>
  );
}

/** `ic_ds_chevron_right_outline_14`: the drill seat's glyph, drawn here because
 * it is the menu's alone (the composer's other glyphs live in `Icons.tsx`).
 * `ComposerCrumbs` reuses it as the trail's separator. */
export function ChevronRight(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24849 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z"
        fill="currentColor"
      />
    </svg>
  );
}