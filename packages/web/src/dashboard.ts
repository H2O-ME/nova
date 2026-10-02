/**
 * The dashboard route: a corpus activity reading folded from every stored
 * session log. The browser asks `GET /api/dashboard` and gets back the
 * aggregate the Context panel's dashboard card renders — a cross-session
 * overview the host's own `aggregateSessions` produces in one walk.
 *
 * Auth gate stays in front (the server dispatches this AFTER the cookie
 * check), so this handler trusts its caller. The route is GET-only; any other
 * method gets a 405 with the allowed verb.
 *
 * The fold is owned by `core` (`session-aggregate.ts`); this file is just the
 * HTTP seam. The reading is computed on every request — cheap enough for a
 * card refresh, and the corpus is bounded by `MAX_SESSION_FILES` — so the
 * server never holds a stale snapshot.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { aggregateSessions, type SessionAggregate } from '@nova-agent/core';

/** The path the browser fetches. */
export const DASHBOARD_PATH = '/api/dashboard';

/** Handle one dashboard request. Returns true when it answered (matched path). */
export async function handleDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  root: string,
): Promise<boolean> {
  if (url.pathname !== DASHBOARD_PATH) return false;
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return true;
  }
  let aggregate: SessionAggregate;
  try {
    aggregate = await aggregateSessions(root);
  } catch {
    sendJson(res, 500, { ok: false, error: 'aggregate failed' });
    return true;
  }
  sendJson(res, 200, { ok: true, aggregate });
  return true;
}

/** Minimal JSON responder — the same shape `image-upload.ts` already owns. */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}
