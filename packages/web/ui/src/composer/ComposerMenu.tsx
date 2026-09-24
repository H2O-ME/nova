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
 * surface has no analogue for: the breadcrumb header of a drilled source, the
 * pending-source skeleton rows, and the combobox keyboard arbitration (arrow
 * keys / Tab / Escape, which live on the harness's editor command layer and
 * would be the composer keymap's business here).
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DRILL_ARIA, DRILL_HINT, DRILL_KEY } from './composer-text.js';
import { MENU_MAX_HEIGHT, menuMaxHeight, menuOverflowBelow } from './composer-measure.js';
import { cx } from './cx.js';
import css from './ComposerMenu.module.css';

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
  icon?: ReactNode;
  /** The shared highlight: pointer motion and keyboard moves park it here. */
  active?: boolean;
  /** A drillable row (a directory): shows the Tab hint and the chevron. */
  drill?: boolean;
}

export function ComposerMenu({
  items,
  groupTitle,
  ariaLabel,
  onPick,
  onDrill,
  onHover,
}: {
  items: readonly ComposerMenuItem[];
  /** A heading for the whole group (skipped when rows carry sections). */
  groupTitle?: string;
  /** The listbox's accessible name. */
  ariaLabel: string;
  onPick?: (item: ComposerMenuItem) => void;
  onDrill?: (item: ComposerMenuItem) => void;
  /** Pointer motion moved onto a row: park the shared highlight there. */
  onHover?: (item: ComposerMenuItem) => void;
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
  }, [items]);
  const updateOverflow = useCallback(() => {
    const viewport = viewportRef.current;
    setOverflowBelow(viewport !== null
      && menuOverflowBelow(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight));
  }, []);
  useLayoutEffect(() => {
    updateOverflow();
  }, [items, maxHeight, updateOverflow]);
  const sections = items.some((item) => item.section !== undefined);
  useEffect(() => {
    if (listRef.current === null) return;
    listRef.current.querySelector('[data-menu-active]')?.scrollIntoView({ block: 'nearest' });
  }, [items]);
  return (
    <div
      ref={listRef}
      className={css.menu}
      style={{ maxHeight }}
      data-trigger-menu=""
      data-overflow-below={overflowBelow || undefined}
    >
      <div
        ref={viewportRef}
        className={css.viewport}
        role="listbox"
        aria-label={ariaLabel}
        onScroll={updateOverflow}
      >
        {items.length === 0
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
                      <span className={css.itemIcon} aria-hidden="true">{item.icon}</span>
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
 * it is the menu's alone (the composer's other glyphs live in `Icons.tsx`). */
function ChevronRight(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24849 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z"
        fill="currentColor"
      />
    </svg>
  );
}