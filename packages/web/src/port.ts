/**
 * Origin durability for the browser surface, port half: the last bound port is
 * remembered and the next start tries it FIRST, so `nova`'s default origin (and
 * with it the browser's localStorage — workspaces, theme, font size) survives
 * restarts instead of changing with every ephemeral bind. Best effort in both
 * directions: a corrupt or out-of-range store is ignored, a busy port falls
 * back to an ephemeral bind, and a failed store write never fails the server.
 *
 * This is what makes a PWA installable at all: an install is bound to an
 * origin, and an origin that changes every boot is a new app every boot.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { webPortStorePath } from '@nova-agent/core';

const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Read the remembered port. Anything suspicious reads as "no preference". */
export async function readPreferredPort(
  file: string = webPortStorePath(),
): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const port = (parsed as { port?: unknown }).port;
    if (
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < MIN_PORT ||
      port > MAX_PORT
    ) {
      return undefined;
    }
    return port;
  } catch {
    return undefined;
  }
}

/** Remember the bound port. A write failure is logged, never thrown. */
export async function writePreferredPort(port: number, file: string = webPortStorePath()): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ port })}\n`, 'utf8');
  } catch (err) {
    console.error(`warning: 无法记录 WebUI 端口（下次启动将重新随机分配）: ${errMessage(err)}`);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
