/**
 * The persisted half of the launch pairing (`~/.nova/cache/web-auth.json`):
 * the durable `cookieToken` + `secret` a cookie carries, so an installed PWA
 * (or any bookmarked tab) stays authenticated across server restarts. The
 * URL token is NOT persisted — it stays per-boot, keeping the one-time
 * pairing property of the printed link. Deleting the file revokes every
 * outstanding cookie; the next start mints a fresh pairing.
 *
 * IO discipline: corrupt or half-written store → fresh pairing (fail open to
 * re-pairing, never to an attacker-controlled identity — values are validated
 * as hex of the exact expected length before use); write failure → warn and
 * continue with an ephemeral pairing, never fail the server.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { webAuthStorePath } from '@nova-agent/core';
import { createLaunchAuth, type LaunchAuth } from './auth.js';

const HEX_SECRET = /^[0-9a-f]{64}$/;
const HEX_TOKEN = /^[0-9a-f]{32}$/;

/**
 * Load the persisted pairing, creating it on first use. The returned auth's
 * URL `token` is always fresh for this process.
 */
export async function loadLaunchAuth(file: string = webAuthStorePath()): Promise<LaunchAuth> {
  const auth = createLaunchAuth();
  let persisted: { cookieToken?: unknown; secret?: unknown } | undefined;
  try {
    persisted = JSON.parse(await readFile(file, 'utf8')) as typeof persisted;
  } catch {
    persisted = undefined;
  }
  const cookieToken = typeof persisted?.cookieToken === 'string' ? persisted.cookieToken : '';
  const secret = typeof persisted?.secret === 'string' ? persisted.secret : '';
  if (HEX_TOKEN.test(cookieToken) && HEX_SECRET.test(secret)) {
    return { token: auth.token, secret, cookieToken };
  }
  // No usable store: mint a fresh durable half. The cookie then pairs with
  // THIS process; the store write below (best effort) makes it outlive us.
  const fresh = { cookieToken: randomHex(16), secret: randomHex(32) };
  await persist(file, fresh);
  return { token: auth.token, secret: fresh.secret, cookieToken: fresh.cookieToken };
}

async function persist(
  file: string,
  value: { cookieToken: string; secret: string },
): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ v: 1, ...value }, null, 2)}\n`, {
      encoding: 'utf8',
      // Owner-only on POSIX; Windows per-user profiles need no extra ACL work.
      ...(process.platform === 'win32' ? {} : { mode: 0o600 }),
    });
  } catch (err) {
    console.error(`warning: 无法持久化 WebUI 配对（重启后浏览器需重新用终端 URL 配对）: ${errMessage(err)}`);
  }
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
