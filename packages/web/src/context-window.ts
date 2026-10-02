/**
 * The context-window route: a frozen snapshot of one request's window — what
 * the Browser and DNA cards read. `GET /api/context-window?session=<id>&seq=<n>`
 * folds the named session's log with the SAME fold the live path uses, then
 * returns the elements that were on the surface when the request at `seq` ran.
 *
 * Auth gate stays in front (the server dispatches this AFTER the cookie
 * check). The session id is validated by `sessionLogPath` (must end in
 * `.jsonl` and sit under the sessions root — the same boundary delete/resume
 * already use), and `seq` is parsed as a non-negative integer. Anything malformed
 * answers a JSON error rather than a hanging connection.
 *
 * The route statically imports `windowAtSeq` from `@nova-agent/plugin-context`
 * — the ONE definition of "what was in the window" — so the Browser/DNA cards
 * and the trend's view of a past request cannot disagree.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readEvents, sessionLogPath, type SessionEvent } from '@nova-agent/core';
import { windowAtSeq } from '@nova-agent/plugin-context';

/** The path the browser fetches. */
export const CONTEXT_WINDOW_PATH = '/api/context-window';

/** Handle one context-window request. Returns true when it answered. */
export async function handleContextWindow(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  root: string,
): Promise<boolean> {
  if (url.pathname !== CONTEXT_WINDOW_PATH) return false;
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return true;
  }
  const session = url.searchParams.get('session');
  const seqRaw = url.searchParams.get('seq');
  if (session === null || session === '' || seqRaw === null) {
    sendJson(res, 400, { ok: false, error: 'session and seq are required' });
    return true;
  }
  const seq = Number.parseInt(seqRaw, 10);
  if (!Number.isFinite(seq) || seq < 0) {
    sendJson(res, 400, { ok: false, error: 'seq must be a non-negative integer' });
    return true;
  }
  // Validate the session id sits under the sessions root BEFORE reading it —
  // the same boundary delete/resume use (`sessionLogPath` throws on traversal).
  let file: string;
  try {
    file = sessionLogPath(session, root);
  } catch {
    sendJson(res, 400, { ok: false, error: 'session path is outside the sessions dir' });
    return true;
  }
  let events: SessionEvent[];
  try {
    const result = await readEvents(file);
    events = result.events;
  } catch {
    sendJson(res, 404, { ok: false, error: 'session not found' });
    return true;
  }
  const snapshot = windowAtSeq(events, seq);
  if (snapshot === undefined) {
    // No element entered before seq — a missing position, not an empty window.
    sendJson(res, 404, { ok: false, error: 'no window at this seq' });
    return true;
  }
  sendJson(res, 200, { ok: true, snapshot });
  return true;
}

/** Minimal JSON responder — the same shape `dashboard.ts` already owns. */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}
