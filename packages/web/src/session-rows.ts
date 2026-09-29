/**
 * The sidebar's row policy: which sessions a reader is shown, and in what
 * wire shape.
 *
 * It lives beside the controller rather than inside it for the same reason
 * `model-seat.ts` and `session-pages.ts` do: it is a decision, not routing.
 * The controller asks once and ships the answer; the enum below is the whole
 * contract.
 */
import { type AgentSession, type SessionEntry, type SessionListing } from '@nova-agent/core';
import type { SessionListItem } from './protocol.js';

/** How many rows a reader gets. */
export const SESSION_LIST_LIMIT = 30;

/**
 * Extra heads read past the page so dropping blank sessions cannot shorten it.
 * A bound, not a guarantee: a hundred abandoned blank logs yields a short page
 * rather than an unbounded scan.
 */
const BLANK_SCAN_SLACK = 20;

/**
 * The rows for the currently attached reader.
 *
 * A blank session is the provisional "new session" slot, so only the one open
 * belongs in the list — every blank left behind by a switch is an empty log
 * whose row would read "新会话" and name nothing. Heads are read past the page
 * before blank ones are dropped, because cutting first and filtering after
 * would hand back a short page while real sessions sat just below the cut.
 *
 * @param listing - the memoized enumeration (heads already paid for are kept).
 * @param agent - the open session, whose own file is the blank row allowed through.
 * @returns rows newest-first, at most {@link SESSION_LIST_LIMIT} of them.
 */
export async function sessionRows(
  listing: SessionListing,
  agent: AgentSession,
): Promise<SessionListItem[]> {
  const current = agent.session.file;
  const entries: SessionEntry[] = await listing.list(SESSION_LIST_LIMIT + BLANK_SCAN_SLACK);
  return entries
    .filter((entry) => !entry.blank || entry.file === current)
    .slice(0, SESSION_LIST_LIMIT)
    .map((entry) => ({
      file: entry.file,
      title: entry.title,
      mtime: entry.mtime,
      ...(entry.workspace !== undefined ? { workspace: entry.workspace } : {}),
    }));
}
