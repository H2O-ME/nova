/**
 * The persisted launch pairing: durable cookieToken + secret under the cache
 * root, so the cookie outlives the process while the URL token does not.
 * Failure modes are the contract here — a corrupt store reads as absent
 * (fresh pairing, never a half-attacker-controlled identity), and a reload
 * of the SAME store reproduces the SAME identity (that is the whole point).
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cookieValue, verifyCookie } from '../src/auth.js';
import { loadLaunchAuth } from '../src/auth-store.js';

async function storeFile(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), 'nova-webauth-')), 'web-auth.json');
}

describe('persisted launch pairing', () => {
  it('the same store reproduces the same identity across "restarts"', async () => {
    const file = await storeFile();
    const first = await loadLaunchAuth(file);
    const second = await loadLaunchAuth(file);
    expect(second.cookieToken).toBe(first.cookieToken);
    expect(second.secret).toBe(first.secret);
    // The URL token stays per-boot even though the pairing is stable.
    expect(second.token).not.toBe(first.token);
  });

  it('a cookie minted before a restart still verifies after it', async () => {
    const file = await storeFile();
    const first = await loadLaunchAuth(file);
    const cookie = cookieValue(first, first.token);
    const second = await loadLaunchAuth(file);
    expect(verifyCookie(second, `nova_ws=${cookie}`)).toBe(true);
  });

  it('a corrupt store is discarded, not trusted (fresh pairing)', async () => {
    const file = await storeFile();
    await writeFile(file, '{"cookieToken": "PROTOTYPE", "secret": "nope"}', 'utf8');
    const auth = await loadLaunchAuth(file);
    // Values failed hex validation → the persisted pair is ignored and a new
    // durable pair was minted (and written back for the NEXT boot).
    expect(auth.cookieToken).toMatch(/^[0-9a-f]{32}$/);
    expect(auth.secret).toMatch(/^[0-9a-f]{64}$/);
    const reloaded = await loadLaunchAuth(file);
    expect(reloaded.cookieToken).toBe(auth.cookieToken);
  });

  it('an unreadable store (a directory in place of the file) still starts', async () => {
    // A path that cannot be read or written must not take the server down:
    // load succeeds with SOME pairing; persisting just warns.
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-webauth-'));
    const auth = await loadLaunchAuth(dir);
    expect(auth.cookieToken).toMatch(/^[0-9a-f]{32}$/);
  });
});
