/**
 * The hero's 最近工作 list: the sessions this browser can jump back into,
 * printed under the composer card of an otherwise empty column.
 *
 * The empty state used to be one headline over one card, which said nothing
 * about the work already on disk — the only way back into a session was the
 * left navigation column the hero is asking the reader to skip. The block has
 * two jobs and states them structurally: the card starts a task, this list
 * continues one. Four single-line rows, no icons, no cards: a compact run of
 * title + workspace + age reads as "resume what you were doing"; a grid of
 * cards reads as a dashboard.
 *
 * Ordering is mtime DESC, computed here instead of trusted from the frame: the
 * host's list happens to arrive newest-first, but a list that claims to be
 * recent must sort by the fact it claims. The session the kernel is attached to
 * is left out — resuming it is a no-op, and the hero is the blank column, not a
 * session.
 */
import type { SessionListItem } from '../types.js';
import { NO_WORKSPACE_LABEL, workspaceLabel } from '../session-groups.js';
import { sessionTitle } from '../sidebar/view.js';
import { relativeStamp } from '../sidebar/relative-time.js';
import css from './RecentSessions.module.css';

/** How many rows the hero shows before the sidebar takes over. */
export const RECENT_SESSION_LIMIT = 4;

/**
 * The rows the hero prints: newest first, current session excluded, capped.
 * @param items - the host's session list, or null before the first frame.
 * @param currentFile - the log the kernel is attached to (excluded).
 * @param limit - how many rows to keep.
 * @returns the rows to render, never more than `limit`.
 */
export function recentSessions(
  items: readonly SessionListItem[] | null,
  currentFile: string | undefined,
  limit: number = RECENT_SESSION_LIMIT,
): SessionListItem[] {
  if (items === null) return [];
  return [...items]
    .filter((item) => item.file !== currentFile)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

/**
 * The workspace name a row states. A log may carry no workspace at all (an old
 * log, or one written without a root), and `workspaceLabel('')` is an empty
 * string — an empty cell would read as a rendering bug rather than as "this
 * session belongs to no workspace".
 * @param item - the row's session.
 * @returns the display name.
 */
function workspaceOf(item: SessionListItem): string {
  const workspace = item.workspace;
  if (workspace === undefined || workspace === '') return NO_WORKSPACE_LABEL;
  return workspaceLabel(workspace);
}

export interface RecentSessionsProps {
  /** The host's session list (`null` until the first `sessions` frame). */
  items: readonly SessionListItem[] | null;
  /** The log the kernel is attached to (excluded from the list). */
  currentFile?: string | undefined;
  /** Open a session log (`resume`); the kernel restores its workspace. */
  onOpen: (file: string) => void;
}

/**
 * Render the hero's recent-session list. Before the first `sessions` frame the
 * block holds its caption with a quiet pending line (so the rows land in place
 * instead of the whole block popping in); after the frame an empty list is
 * still ABSENT on purpose — an empty shelf announcing a feature with no content
 * says nothing.
 * @param props - see {@link RecentSessionsProps}.
 * @returns the list element, the pending hold, or null when there is nothing to resume.
 */
export function RecentSessions({ items, currentFile, onOpen }: RecentSessionsProps): JSX.Element | null {
  // The pre-frame hold: caption + pending line at roughly a row's height, so
  // the landing rows replace the line instead of inserting a whole block.
  if (items === null) {
    return (
      <nav className={css.root} aria-label="最近工作">
        <div className={css.heading}>最近工作</div>
        <div className={css.pending} role="status">
          正在载入…
        </div>
      </nav>
    );
  }
  const rows = recentSessions(items, currentFile);
  // Nothing to resume: the block is ABSENT rather than an empty shelf
  // announcing a feature with no content.
  if (rows.length === 0) return null;
  // One clock per render, the session list's rule: two rows a frame apart must
  // not disagree about what "now" is.
  const now = Date.now();
  return (
    <nav className={css.root} aria-label="最近工作">
      <div className={css.heading}>最近工作</div>
      <ul className={css.list}>
        {rows.map((item) => (
          <li key={item.file}>
            {/* Title over workspace · age, 40px a row. The title gets the full
                line (so a long prompt truncates instead of starving its own
                metadata); the metadata is the quieter second line. */}
            <button
              type="button"
              className={css.row}
              title={item.title.length > 0 ? item.title : item.file}
              onClick={() => { onOpen(item.file); }}
            >
              <span className={css.title}>{sessionTitle(item)}</span>
              <span className={css.meta}>
                <span className={css.workspace}>{workspaceOf(item)}</span>
                <span className={css.dot} aria-hidden="true">·</span>
                <span className={css.time}>{relativeStamp(item.mtime, now)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
