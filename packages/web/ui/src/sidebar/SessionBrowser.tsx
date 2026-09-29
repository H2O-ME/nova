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
import { QueueOutline14 } from '../composer/Icons.js';
import { groupByWorkspace } from '../session-groups.js';
import type { SessionListItem } from '../types.js';
import { AnimatedRows } from './AnimatedRows.js';
import { DeleteSessionDialog } from './DeleteSessionDialog.js';
import { ListHeader } from './ListHeader.js';
import { SessionRow, ProjectRow } from './SessionRow.js';
import { readGroupMode, writeGroupMode, type GroupMode } from './list-view.js';
import {
  SIDEBAR_COPY as COPY,
  autoExpandKey,
  cls,
  groupKey,
  nextSessionLimit,
  rowKeysOf,
  sessionTitle,
  sidebarRows,
  type SidebarRow,
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
  /** Delete one session log (`delete_session`); the listing answers. */
  onDelete: (file: string) => void;  /** Re-ask the host for the list (`list_sessions`). */
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
  onDelete,
  onReload,
  onExpand,
}: SessionBrowserProps): JSX.Element {
  const [mode, setMode] = useState<GroupMode>(() => readGroupMode());
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const groups = useMemo(() => groupByWorkspace(items ?? []), [items]);
  // Group folds (the reference's `groupExpansion`, default closed) and the
  // per-group reveal LIMIT (its `sessionLimits`): a number, not a flag, because
  // the control steps by one chunk per click rather than jumping to the end.
  const [expansion, setExpansion] = useState<Record<string, boolean>>({});
  const [sessionLimits, setSessionLimits] = useState<Record<string, number>>({});
  /**
   * The session awaiting delete confirmation, or null. Held as the whole item,
   * not its file: the dialog names the session, and the row it came from may
   * disappear from the list while the dialog is open.
   */
  const [confirming, setConfirming] = useState<SessionListItem | null>(null);

  // The group owning the current session opens on first sight; a fold the user
  // has already decided about stays put (the reference's `Object.hasOwn` guard).
  useEffect(() => {
    const key = autoExpandKey(groups, currentFile, expansion);
    if (key !== undefined) setExpansion((current) => ({ ...current, [key]: true }));
  }, [groups, currentFile, expansion]);

  const loading = items === null;
  const searching = query.trim().length > 0;

  /**
   * The clock the rows date themselves against. Read once per render rather
   * than per row: two rows a frame apart would otherwise disagree about what
   * "now" is, and the reference reads it the same way (`WorkspaceBrowser`).
   * It re-reads on every list change, which is also every moment a stamp can
   * move from "5分钟" to "6分钟".
   */
  const now = Date.now();

  const pickMode = (next: GroupMode): void => {
    setMode(next);
    writeGroupMode(next);
  };

  /**
   * The rows to render. ONE value drives both the markup and the animation
   * keys, so the two cannot describe different lists — a mismatch would animate
   * rows that are not on screen (see `sidebarRows`).
   */
  const rowTree = useMemo(() => sidebarRows({
    items,
    groups,
    mode,
    query,
    searching,
    expansion,
    sessionLimits,
    currentFile,
  }), [items, groups, mode, query, searching, expansion, sessionLimits, currentFile]);
  const rowKeys = useMemo(() => rowKeysOf(rowTree), [rowTree]);

  /**
   * Whether the rows are a flat run rather than a grouped tree.
   *
   * The SAME two conditions `sidebarRows` branches on (search hits, or the
   * single-list mode), named once here so the markup's row rhythm cannot
   * disagree with the shape the tree actually returned.
   */
  const flatRows = searching || mode === 'flat';

  /** One row's markup. Groups render their children, so this recurses. */
  const renderRow = (row: SidebarRow): JSX.Element => {
    if (row.kind === 'message') {
      // `data-row-key` on a state row too: `rowKeysOf` hands the animation every
      // key in this tree, and `AnimatedRows` diffs DOM order of `data-row-key`.
      // A key with no element would be a row the animation is told about but
      // cannot find.
      return (
        <div
          key={row.key}
          data-row-key={row.key}
          // Three readings, the reference's own split: an empty LIST is a
          // centered placeholder (`.emptyState`), a search with no hits is a
          // plain line (`.empty`), and the scope note is the caption over the
          // hits (`.scopeNote`).
          className={row.key === 'empty' ? css.emptyState : row.note ? css.scopeNote : css.empty}
        >
          {/* The empty LIST carries the reference's own glyph over its line
              (`EmptySessions` renders `IconQueueOutlineRegular` at 24 over the
              text). A list with nothing in it is the first thing a new install
              shows, and the mark is what separates "nothing here yet" from a
              line of text that failed to load. */}
          {row.key === 'empty' && <QueueOutline14 className={css.emptyGlyph} />}
          {row.text}
        </div>
      );
    }
    if (row.kind === 'session') {
      return (
        <SessionRow
          key={row.key}
          item={row.item}
          selected={row.item.file === currentFile}
          now={now}
          onOpen={() => { onOpen(row.item.file); }}
          onDelete={() => { setConfirming(row.item); }}
        />
      );
    }
    const key = groupKey(row.group);
    return (
      // Group section: header row + expanded top-level session rows. The
      // inter-group breathing room is the section's own margin, which is why
      // the group is a wrapper rather than a flat sibling.
      <div key={row.key} className={css.groupSection}>
        <ProjectRow
          label={row.group.label}
          path={row.group.path}
          rowKey={row.key}
          expanded={row.expanded}
          containsCurrent={row.containsCurrent}
          onToggle={() => {
            setExpansion((current) => ({ ...current, [key]: !row.expanded }));
          }}
        />
        {row.children.length > 0 && (
          // The overflow control is a group child but carries a button's
          // semantics; every other child is a session row.
          row.children.map((child) => (child.kind === 'message' && child.key.startsWith('overflow:')
            ? (
                <button
                  key={child.key}
                  type="button"
                  className={css.sessionOverflowButton}
                  data-row-key={child.key}
                  aria-expanded={row.sessionsExpanded}
                  onClick={() => {
                    // One chunk per press (the reference's step): a group holding
                    // 200 sessions must not go from 5 rows to 200, and the final
                    // press must land on 收起 rather than leaving a second
                    // overflow row holding the tail.
                    setSessionLimits((current) => ({
                      ...current,
                      [key]: nextSessionLimit(current[key], row.hiddenCount, row.sessionsExpanded),
                    }));
                  }}
                >
                  {child.text}
                </button>
              )
            : renderRow(child)))
        )}
      </div>
    );
  };

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
          // `data-flat` marks a run of top-level session rows with no group
          // wrapper (single-list mode and search hits). The grouped tree gets its
          // 2px row rhythm from `.groupSection > * + *`; without this hook a flat
          // run had no rhythm at all and read as a tighter block than the tree
          // beside it — the reference expresses the same distinction with its
          // `.flatList` / `.searchTree` classes.
          <div className={cls(css.treeBody, css.wide)} data-flat={flatRows ? '' : undefined}>
            <AnimatedRows
              className={css.list}
              label={COPY['section.sessions']}
              rowKeys={rowKeys}
              // The placeholder is not a list state to animate: rows flying in
              // on every attach would read as churn rather than as an answer.
              ready={!loading}
              // A view REPLACEMENT, not a reorder — the reference keys on
              // `[animationResetKey, sessionLimits]` for exactly these three:
              // a grouping switch, a new search, and revealing a group's
              // remaining sessions. Each swaps the list rather than moving it,
              // so its rows must fade in where they belong instead of gliding
              // across the panel from whatever they replaced.
              resetKey={`${mode}|${searching ? query : ''}|${Object.entries(sessionLimits).map(([k, v]) => `${k}:${String(v)}`).join(',')}`}
            >
              {rowTree.map(renderRow)}
            </AnimatedRows>
            <span className={css.fade} />
          </div>
        )}
      </div>
      {/* One dialog per confirmed session, keyed by the log: a second delete
          while one is open starts a fresh dialog rather than reusing the state
          of the first (its title and target are the previous session's). */}
      {confirming !== null && (
        <DeleteSessionDialog
          key={confirming.file}
          title={sessionTitle(confirming)}
          onConfirm={() => {
            onDelete(confirming.file);
            setConfirming(null);
          }}
          onClose={() => { setConfirming(null); }}
        />
      )}
    </div>
  );
}