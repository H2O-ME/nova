/**
 * Browser auth for the single-process web surface (dsh's launch-token →
 * signed-cookie pattern, minimized). No accounts, no sessions database:
 * the server mints a one-time launch token per process; the first visit
 * `/?t=<token>` verifies it against the in-memory value and sets an
 * HttpOnly, SameSite=Strict, host-only cookie signed with a per-process
 * HMAC secret. Every later static request and the WS upgrade must present
 * a matching cookie — a page at any other origin can't read it (SameSite +
 * HttpOnly), and a guessed token can't produce the signature.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const AUTH_COOKIE = 'nova_ws';

export interface LaunchAuth {
  /** The token embedded in the launch URL the user (or `nova --web`) opens. */
  readonly token: string;
  readonly secret: string;
}

export function createLaunchAuth(): LaunchAuth {
  return { token: randomBytes(16).toString('hex'), secret: randomBytes(32).toString('hex') };
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
  return `${token}.${sign(auth.secret, token)}`;
}

/** `Set-Cookie` attributes: host-only, HttpOnly, SameSite=Strict, path-scoped. */
export function cookieHeader(value: string): string {
  return `${AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict`;
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
  const expected = sign(auth.secret, token);
  return safeEqual(sig, expected) && safeEqual(token, auth.token);
}
