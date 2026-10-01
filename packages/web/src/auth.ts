/**
 * Browser auth for the single-process web surface (dsh's launch-token →
 * signed-cookie pattern, minimized). The first visit `/?t=<token>` verifies
 * the one-time launch token against the in-memory value and sets an HttpOnly,
 * SameSite=Strict, host-only cookie; every later request and the WS upgrade
 * must present a matching cookie. The URL token stays per-process (one-time
 * pairing); the COOKIE identity — a durable `cookieToken` signed with a
 * durable `secret`, supplied by `auth-store.ts` — is what an installed PWA
 * replays, so it outlives the process. Delete the store and every cookie
 * invalidates; re-pair from the terminal URL.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const AUTH_COOKIE = 'nova_ws';

export interface LaunchAuth {
  /** The token embedded in the launch URL the user (or `nova --web`) opens. */
  readonly token: string;
  readonly secret: string;
  /**
   * The identity the cookie carries. Ephemeral pairings fold the URL token in
   * here; a persisted pairing keeps its own value, so the cookie survives
   * restarts the URL token deliberately does not.
   */
  readonly cookieToken: string;
}

export function createLaunchAuth(): LaunchAuth {
  const token = randomBytes(16).toString('hex');
  return { token, secret: randomBytes(32).toString('hex'), cookieToken: token };
}

function sign(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/** Constant-time compare without early exit on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** The cookie value for a verified launch token (set by the GET /?t= hop). */
export function cookieValue(auth: LaunchAuth, token: string): string | undefined {
  if (!safeEqual(token, auth.token)) return undefined;
  return `${auth.cookieToken}.${sign(auth.secret, auth.cookieToken)}`;
}

/** `Set-Cookie` attributes: host-only, HttpOnly, SameSite=Strict, path-scoped, persistent. */
export function cookieHeader(value: string): string {
  return `${AUTH_COOKIE}=${value}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`;
}

/** Verify a Cookie header value against the launch auth. */
export function verifyCookie(auth: LaunchAuth, cookieHeader: string | undefined): boolean {
  const match = /(?:^|;\s*)nova_ws=([^;]+)/.exec(cookieHeader ?? '');
  const value = match?.[1];
  if (value === undefined) return false;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return false;
  const token = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(auth.secret, auth.cookieToken);
  return safeEqual(sig, expected) && safeEqual(token, auth.cookieToken);
}
