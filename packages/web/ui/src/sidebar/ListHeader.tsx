/**
 * The session list's section header: the section word, the inline search that
 * takes the row when it opens, the view-options control, and the reload.
 * Ported from deepseek-harness `ui-workspace` WorkspaceBrowser's `.sectionHeader`
 * block + its `.search` / `.searchSlot` rules (c) 2026 DeepSeek — MIT License.
 *
 * Two structural facts of the reference are kept: the label yields its width to
 * the search when it expands (it is the one part of the row that is not a
 * control), and the header is a single 36px row at every state, so the list
 * below it never moves. The reference's "add workspace" control is absent by
 * its own rule — a composition with no picking affordance hides the button
 * rather than leaving a dead one in the header (this product picks a workspace
 * by starting the kernel somewhere; there is no in-place picker).
 *
 * The reload control is ours: the reference is pushed its list by the host,
 * while this surface asks (`list_sessions`) and so needs a way to ask again.
 */
import { useEffect, useRef } from 'react';
import { CloseIcon, RefreshIcon, SearchIcon } from '../icons.js';
import { Tooltip } from '../shell/Tooltip.js';
import { LIST_COPY, sectionLabel, type GroupMode } from './list-view.js';
import { SIDEBAR_COPY, cls } from './view.js';
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
  /** Rail state: the label and the search field collapse to controls. */
  rail: boolean;
  /** Rail search: the column has to widen before a field can be typed in. */
  onExpand: () => void;
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
  rail,
  onExpand,
}: ListHeaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Opening the field is one gesture; focusing it is the other half, and it
  // has to happen after the input exists.
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  if (rail) {
    // The rail's two controls are bare glyphs with no label anywhere on screen,
    // so each carries a real tooltip: `title` never appears for a keyboard user,
    // and the reference wraps these seats in its Tooltip primitive for exactly
    // that reason.
    return (
      <div className={cls(css.railControls)}>
        <Tooltip label={LIST_COPY['search.sessions.aria']} side="right" delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={LIST_COPY['search.sessions.aria']}
            title={LIST_COPY['search.sessions.aria']}
            onClick={() => {
              onExpand();
              onSearchOpen(true);
            }}
          >
            <SearchIcon className={css.actionIcon} />
          </button>
        </Tooltip>
        <Tooltip label={SIDEBAR_COPY['list.reload']} side="right" delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={SIDEBAR_COPY['list.reload']}
            title={SIDEBAR_COPY['list.reload']}
            onClick={onReload}
          >
            <RefreshIcon className={css.actionIcon} />
          </button>
        </Tooltip>
      </div>
    );
  }

  const expanded = searchOpen || query.length > 0;
  return (
    <div className={css.sectionHeader}>
      <span className={cls(css.sectionLabel, expanded && css.sectionLabelHidden)}>
        {sectionLabel(mode)}
      </span>
      <div className={cls(css.searchSlot, expanded && css.searchSlotExpanded)}>
        <div
          className={cls(css.search, expanded && css.searchExpanded)}
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
      <div className={cls(css.headerActions, expanded && css.headerActionsHidden)}>
        <ViewOptions mode={mode} onPick={onPickMode} triggerClassName={css.iconButton} />
        <button
          type="button"
          className={css.iconButton}
          aria-label={SIDEBAR_COPY['list.reload']}
          title={SIDEBAR_COPY['list.reload']}
          onClick={onReload}
        >
          <RefreshIcon className={css.actionIcon} />
        </button>
      </div>
    </div>
  );
}