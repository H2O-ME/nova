import os from 'node:os';
import path from 'node:path';

/**
 * The on-disk layout of a nova installation — `~/.nova/`, the ONE data root
 * (config, sessions, skills, spill caches). Owned by core because session
 * persistence, compaction archives and the tool-output spill all resolve
 * paths against it, and every surface assembles kernels through the same
 * layout. The workspace itself is never written to (zero-write rule).
 */
export const NOVA_DIR = '.nova';

/** nova's home: `~/.nova/`. Overridable homedir for tests. */
export function novaHome(homedir: string = os.homedir()): string {
  return path.join(homedir, NOVA_DIR);
}

export function userConfigPath(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'config.json');
}

/** Sessions root (codex-style date buckets): `~/.nova/sessions/YYYY/MM/DD/`. */
export function sessionsRoot(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'sessions');
}

/** Local-timezone YYYY/MM/DD parts (the context fragment's `today` and the date bucket share this source). */
export function localDateKey(now: Date = new Date()): [string, string, string] {
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return [yyyy, mm, dd];
}

/** The date bucket a new session lands in (cross-day runs switch buckets). */
export function sessionDateBucket(now: Date = new Date()): string {
  return localDateKey(now).join('/');
}

/** Directory new sessions are created in (startup assembly and /new share it). */
export function newSessionDir(): string {
  return path.join(sessionsRoot(), sessionDateBucket());
}

/** Cache root: `~/.nova/cache/` (model catalog etc. live alongside the spill). */
export function cacheRoot(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'cache');
}

/**
 * Tool-output spill root — `~/.nova/cache/tool-outputs/` (the trusted read
 * root exemption) or, with `sessionId`, that session's own group dir.
 */
export function toolOutputsDir(sessionId?: string, homedir: string = os.homedir()): string {
  const root = path.join(cacheRoot(homedir), 'tool-outputs');
  return sessionId === undefined ? root : path.join(root, sessionId);
}
