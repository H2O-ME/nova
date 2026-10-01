import os from 'node:os';
import path from 'node:path';

/** The on-disk layout: `~/.nova/` (the ONE data root) plus `~/.agents/`. */
export const NOVA_DIR = '.nova';

/** nova's home: `~/.nova/`. Overridable homedir for tests. */
export function novaHome(homedir: string = os.homedir()): string {
  return path.join(homedir, NOVA_DIR);
}

/** `~/.agents/` — the cross-tool agent data directory other tools share. */
export function agentsHome(homedir: string = os.homedir()): string {
  return path.join(homedir, '.agents');
}

export function userConfigPath(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'config.json');
}

/** Sessions root (codex-style date buckets): `~/.nova/sessions/YYYY/MM/DD/`. */
export function sessionsRoot(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'sessions');
}

/**
 * `<base>/.agents/skills` — the standard skills root and the ONLY definition of
 * the `.agents` layout. `base` is a home for the user level, a project root for
 * the project level; both levels read the same convention.
 */
export function agentsSkillsRoot(base: string = os.homedir()): string {
  return path.join(agentsHome(base), 'skills');
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

/** Web surface stores: the last bound port (origin survives restarts) and the
 * launch pairing (cookies outlive the process — a PWA needs no URL token). */
export function webPortStorePath(homedir: string = os.homedir()): string {
  return path.join(cacheRoot(homedir), 'web-port.json');
}

export function webAuthStorePath(homedir: string = os.homedir()): string {
  return path.join(cacheRoot(homedir), 'web-auth.json');
}

/** models.dev catalog cache: `~/.nova/cache/models-dev.json` — the sole definition. */
export function modelsDevStorePath(homedir: string = os.homedir()): string {
  return path.join(cacheRoot(homedir), 'models-dev.json');
}

/*
 * There is no `uploadsDir`. It named `~/.nova/cache/uploads/`, where a dropped
 * file's bytes were copied so `read_file` could reach them — but a local file
 * already has a path, the model end is pure text, and nothing here reads images
 * or video. The copy therefore fed the model nothing while duplicating the
 * user's bytes in a directory that only ever grew. A prompt references the
 * original path instead, so no such root is needed.
 */
