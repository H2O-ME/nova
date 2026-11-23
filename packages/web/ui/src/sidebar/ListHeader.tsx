/**
 * The session list's section header: the section word, the inline search that
 * takes the row when it opens, and the view-options control (whose menu also
 * carries the reload row).
 *
 * Two structural facts of the reference are kept: the label yields its width to
 * the search when it expands (it is the one part of the row that is not a
 * control), and the header is a single 32px block at every state (the
 * reference's 24px control row plus its `pb-2`, ProjectSidebarListHeader.tsx:31),
 * so the list below it never moves. The reference's "add workspace" control is
 * absent by its own rule — a composition with no picking affordance hides the
 * button rather than leaving a dead one in the header (this product picks a
 * workspace by starting the kernel somewhere; there is no in-place picker).
 *
 * The reload control is ours (the reference is pushed its list by the host,
 * while this surface asks `list_sessions` and so needs a way to ask again); it
 * lives in the view menu's tail, not on the header — the header keeps the
 * reference's two-glyph shape.
 */
import { useEffect, useRef } from 'react';
import { CloseIcon, SearchIcon } from '../icons.js';
import { LIST_COPY, sectionLabel, type GroupMode } from './list-view.js';
import { cx } from '../composer/cx.js';
import { ViewOptions } from './ViewOptions.js';
import css from './SessionBrowser.module.css';

export interface ListHeaderProps {
  /** Grouping in force (the section word and the menu's check follow it). */
  mode: GroupMode;
  onPickMode: (mode: GroupMode) => void;
  /** The search box's contents. */
  query: string;
  onQuery: (query: string) => void;
  /** Whether the search field is open (a query keeps it open). */
  searchOpen: boolean;
  onSearchOpen: (open: boolean) => void;
  onReload: () => void;
}

/**
 * Render the browsing region's header.
 * @param props - see ListHeaderProps.
 * @returns the header element tree.
 */
export function ListHeader({
  mode,
  onPickMode,
  query,
  onQuery,
  searchOpen,
  onSearchOpen,
  onReload,
}: ListHeaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Opening the field is one gesture; focusing it is the other half, and it
  // has to happen after the input exists.
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const expanded = searchOpen || query.length > 0;
  return (
    <div className={css.sectionHeader}>
      <span className={cx(css.sectionLabel, expanded && css.sectionLabelHidden)}>
        {sectionLabel(mode)}
      </span>
      <div className={cx(css.searchSlot, expanded && css.searchSlotExpanded)}>
        <div
          className={cx(css.search, expanded && css.searchExpanded)}
          onClick={() => { onSearchOpen(true); }}
        >
          <button
            type="button"
            className={css.searchButton}
            aria-label={LIST_COPY['search.sessions.aria']}
            aria-expanded={expanded}
            title={LIST_COPY['search.sessions.aria']}
            onClick={() => { onSearchOpen(true); }}
          >
            <SearchIcon className={css.searchIcon} />
          </button>
          <input
            ref={inputRef}
            className={css.searchInput}
            type="text"
            value={query}
            placeholder={LIST_COPY['search.placeholder']}
            aria-label={LIST_COPY['search.sessions.aria']}
            tabIndex={expanded ? 0 : -1}
            onChange={(event) => { onQuery(event.target.value); }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              onQuery('');
              onSearchOpen(false);
            }}
          />
          {expanded && (
            <button
              type="button"
              className={css.clearButton}
              aria-label={LIST_COPY['search.clear']}
              title={LIST_COPY['search.clear']}
              onClick={(event) => {
                event.stopPropagation();
                onQuery('');
                onSearchOpen(false);
              }}
            >
              <CloseIcon className={css.clearIcon} />
            </button>
          )}
        </div>
      </div>
      <div className={cx(css.headerActions, expanded && css.headerActionsHidden)}>
        {/* Two controls, the reference's own header (search rides the slot to
            the left): the view menu — which also carries the reload row — and
            nothing else. The header's own reload icon retired 2026-11-14: a
            third glyph beside search and filter read as clutter, and the
            reference's header is exactly two. */}
        <ViewOptions mode={mode} onPick={onPickMode} onReload={onReload} triggerClassName={css.iconButton} />
      </div>
    </div>
  );
}