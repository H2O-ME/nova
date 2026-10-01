import { describe, expect, it } from 'vitest';
import { AUTH_COOKIE, cookieHeader, cookieValue, createLaunchAuth, verifyCookie } from '../src/auth.js';

describe('launch auth cookie', () => {
  it('only the exact launch token yields a cookie value', () => {
    const auth = createLaunchAuth();
    expect(cookieValue(auth, auth.token)).toContain(`${auth.cookieToken}.`);
    expect(cookieValue(auth, 'deadbeef')).toBeUndefined();
    expect(cookieValue(auth, '')).toBeUndefined();
  });

  it('verifyCookie accepts a signed cookie and rejects tampered ones', () => {
    const auth = createLaunchAuth();
    const value = cookieValue(auth, auth.token) as string;
    const header = `${AUTH_COOKIE}=${value}`;
    expect(verifyCookie(auth, header)).toBe(true);
    // Flip the signature (deterministically: appending 'ff' is a no-op 1/256
    // of the time, when the signature already ends in those two hex digits),
    // swap the token, drop the cookie.
    const flipped = header.slice(0, -1) + (header.endsWith('f') ? '0' : 'f');
    expect(verifyCookie(auth, flipped)).toBe(false);
    expect(verifyCookie(auth, `${AUTH_COOKIE}=${auth.cookieToken}.${auth.cookieToken}`)).toBe(false);
    expect(verifyCookie(auth, 'other=x')).toBe(false);
    expect(verifyCookie(auth, undefined)).toBe(false);
  });

  it('a cookie from one process does not verify in another (per-process secret)', () => {
    const a = createLaunchAuth();
    const b = createLaunchAuth();
    const value = cookieValue(a, a.token) as string;
    expect(verifyCookie(b, `${AUTH_COOKIE}=${value}`)).toBe(false);
  });

  it('a persisted pairing verifies across a restart while the URL token rotates', () => {
    // The cookie names the DURABLE identity, so a fresh process with a new URL
    // token still honors it — that is what lets an installed PWA reconnect.
    const first = createLaunchAuth();
    const restarted = { ...first, token: 'f'.repeat(32) };
    const value = cookieValue(first, first.token) as string;
    // Same durable identity → the new boot mints the very same cookie value.
    expect(cookieValue(restarted, restarted.token)).toBe(value);
    expect(verifyCookie(restarted, `${AUTH_COOKIE}=${value}`)).toBe(true);
    // The old URL token no longer mints anything in the new process.
    expect(cookieValue(restarted, first.token)).toBeUndefined();
  });

  it('Set-Cookie is host-hardened and persistent: HttpOnly, SameSite=Strict, Max-Age', () => {
    const header = cookieHeader('tok.sig');
    expect(header).toBe('nova_ws=tok.sig; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict');
  });

  it('cookie parsing survives sibling cookies', () => {
    const auth = createLaunchAuth();
    const value = cookieValue(auth, auth.token) as string;
    expect(verifyCookie(auth, `sid=abc; ${AUTH_COOKIE}=${value}; theme=dark`)).toBe(true);
  });
});
