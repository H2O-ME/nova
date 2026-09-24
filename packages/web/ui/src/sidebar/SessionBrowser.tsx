/**
 * The session list under the sidebar's controls: the section header (its own
 * module), the scrolling body in whichever shape the view options ask for, and
 * the bottom fade.
 * Ported from deepseek-harness `ui-workspace/src/client/rows/WorkspaceBrowser.tsx`
 * (the grouped body and its flat/search result shapes) +
 * `WorkspaceBrowser.module.css` (c) 2026 DeepSeek — MIT License.
 *
 * Three local folds, all the reference's: a workspace group opens on its header
 * row (default closed, the group holding the current session armed open once),
 * an open group shows five session rows before its own overflow control, and a
 * search query replaces the tree with one flat result list while it is typed.
 * None of them is backend state — the host sends the whole list in one
 * `sessions` frame, and everything here is what the browser does with it.
 */
import { useEffect, useMemo, useState } from 'react';
import { groupByWorkspace } from '../session-groups.js';
import type { SessionListItem } from '../types.js';
import { ListHeader } from './ListHeader.js';
import { SessionRow, ProjectRow } from './SessionRow.js';
import { LIST_COPY, filterItems, readGroupMode, writeGroupMode, type GroupMode } from './list-view.js';
import {
  SIDEBAR_COPY as COPY,
  autoExpandKey,
  cls,
  foldedRows,
  groupKey,
  overflowLabel,
  toggled,
} from './view.js';
import css from './SessionBrowser.module.css';

export interface SessionBrowserProps {
  /** The host's session list (`null` until the first `sessions` frame). */
  items: readonly SessionListItem[] | null;
  /** The log the kernel is attached to (row highlight + the open group). */
  currentFile: string;
  /** Rail state: the list unmounts, its controls keep the rail's seats. */
  rail: boolean;
  onOpen: (file: string) => void;
  /** Re-ask the host for the list (`list_sessions`). */
  onReload: () => void;
  /** Rail search needs the column widened before a field can be typed in. */
  onExpand: () => void;
}

/**
 * Render the browsing region.
 * @param props - see SessionBrowserProps.
 * @returns the region element tree.
 */
export function SessionBrowser({
  items,
  currentFile,
  rail,
  onOpen,
  onReload,
  onExpand,
}: SessionBrowserProps): JSX.Element {
  const [mode, setMode] = useState<GroupMode>(() => readGroupMode());
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const groups = useMemo(() => groupByWorkspace(items ?? []), [items]);
  // Group folds (the reference's `groupExpansion`, default closed) and the
  // per-group "show the rest" set (its `expandedSessionGroups`).
  const [expansion, setExpansion] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<readonly string[]>([]);

  // The group owning the current session opens on first sight; a fold the user
  // has already decided about stays put (the reference's `Object.hasOwn` guard).
  useEffect(() => {
    const key = autoExpandKey(groups, currentFile, expansion);
    if (key !== undefined) setExpansion((current) => ({ ...current, [key]: true }));
  }, [groups, currentFile, expansion]);

  const loading = items === null;
  const searching = query.trim().length > 0;
  const matches = useMemo(() => (searching ? filterItems(items ?? [], query) : []), [items, query, searching]);
  const rows = searching ? matches : (items ?? []);

  const pickMode = (next: GroupMode): void => {
    setMode(next);
    writeGroupMode(next);
  };

  const renderRow = (item: SessionListItem): JSX.Element => (
    <SessionRow
      key={item.file}
      item={item}
      selected={item.file === currentFile}
      onOpen={() => { onOpen(item.file); }}
    />
  );

  return (
    <div className={cls(css.root, rail && css.rail)}>
      <ListHeader
        mode={mode}
        onPickMode={pickMode}
        query={query}
        onQuery={setQuery}
        searchOpen={searchOpen}
        onSearchOpen={setSearchOpen}
        onReload={onReload}
        rail={rail}
        onExpand={onExpand}
      />

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {!rail && (
          <div className={cls(css.treeBody, css.wide)}>
            <div className={css.list} role="tree" aria-label={COPY['section.sessions']}>
              {loading && <div className={css.empty}>{COPY['list.loading']}</div>}
              {!loading && rows.length === 0 && (
                <div className={css.empty}>
                  {searching ? LIST_COPY['search.noMatches'] : COPY['empty.none']}
                </div>
              )}
              {/* A query answers with matches, not with the tree: the note names
                  the scope the search actually covers (titles only — this
                  kernel keeps no content index, which is the reference's own
                  degraded mode). */}
              {searching && rows.length > 0 && (
                <>
                  <div className={css.scopeNote}>{LIST_COPY['search.scope']}</div>
                  {rows.map(renderRow)}
                </>
              )}
              {!searching && mode === 'flat' && rows.map(renderRow)}
              {!searching && mode === 'workspace' && groups.map((group) => {
                const key = groupKey(group);
                const expanded = expansion[key] === true;
                const sessionsExpanded = revealed.includes(key);
                const folded = foldedRows(group.items);
                const containsCurrent = currentFile.length > 0
                  && group.items.some((item) => item.file === currentFile);
                return (
                  // Group section: header row + expanded top-level session rows.
                  // The inter-group breathing room is the section's own margin.
                  <div key={key} className={css.groupSection}>
                    <ProjectRow
                      label={group.label}
                      path={group.path}
                      expanded={expanded}
                      containsCurrent={containsCurrent}
                      onToggle={() => {
                        setExpansion((current) => ({ ...current, [key]: !expanded }));
                      }}
                    />
                    {(expanded ? (sessionsExpanded ? group.items : folded.rows) : []).map(renderRow)}
                    {expanded && folded.hiddenCount > 0 && (
                      <button
                        type="button"
                        className={css.sessionOverflowButton}
                        aria-expanded={sessionsExpanded}
                        onClick={() => { setRevealed((current) => toggled(current, key)); }}
                      >
                        {overflowLabel(folded.hiddenCount, sessionsExpanded)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <span className={css.fade} />
          </div>
        )}
      </div>
    </div>
  );
}