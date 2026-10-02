/**
 * Fetch one request's window snapshot from the host's context-window route.
 *
 * Pure (returns a Promise); the cards call it on demand (a click) rather than
 * on mount, because every open row is a fresh walk over the named session's
 * log and there is no reason to pay for one until a reader asks. The cookie
 * the auth gate set travels with the same-origin request, so this needs no
 * headers of its own.
 */
import type { ContextWindowSnapshot } from '../types.js';

/** The route the host owns. */
const CONTEXT_WINDOW_PATH = '/api/context-window';

/** Query the host for the window at `seq` in session `sessionFile`. */
export async function fetchContextWindow(
  sessionFile: string,
  seq: number,
): Promise<ContextWindowSnapshot | undefined> {
  try {
    const qs = `?session=${encodeURIComponent(sessionFile)}&seq=${seq}`;
    const response = await fetch(`${CONTEXT_WINDOW_PATH}${qs}`, { method: 'GET' });
    if (!response.ok) return undefined;
    const payload = (await response.json().catch(() => undefined)) as
      | { ok?: boolean; snapshot?: ContextWindowSnapshot }
      | undefined;
    if (payload?.ok !== true || payload.snapshot === undefined) return undefined;
    return payload.snapshot;
  } catch {
    return undefined;
  }
}
