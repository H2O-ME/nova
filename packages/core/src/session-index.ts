/**
 * Session enumeration and workspace markers (moved out of the CLI shell with
 * the M11 kernel lift): surfaces (session picker, web sidebar)
 * and the assembly factory all need the same listing/titling rules, so they
 * live next to `Session` itself. The log-head scan that answers each row's
 * fields is `session-peek.ts`; this file is the catalog API on top of it.
 */
import path from 'node:path';
import { novaHome, sessionsRoot } from './paths.js';
import { SessionListing } from './session-listing.js';
import type { Session } from './session.js';

/** One listed session: identity plus the bits a switcher row renders. */
export interface SessionEntry {
  file: string;
  id: string;
  /** Last write time (ms epoch) — the list is sorted newest-first by it. */
  mtime: number;
  /** From the file's session header; undefined when the header is unreadable. */
  createdAt: number | undefined;
  /** First real user prompt (single line, char-capped); '' when none found. */
  title: string;
  /**
   * The workspace the session belongs to: the newest `workspace` marker in the
   * log head, falling back to the seeded `<environment>` fragment's `cwd=`
   * line. Undefined when the head has neither (a session without a marker and
   * without a readable fragment) — surfaces group it under "无工作区".
   */
  workspace: string | undefined;
}

/**
 * One-shot listing (the CLI's picker, tests): the same scan a surface's
 * `SessionListing` runs, without a cache to keep.
 */
export function listRecentSessions(root: string, limit: number): Promise<SessionEntry[]> {
  return new SessionListing(root).list(limit);
}

/**
 * Append the log-only workspace marker so a later session switch can re-point
 * the tools at the workspace the session was created in.
 */
export async function recordSessionWorkspace(session: Session, rootDir: string): Promise<void> {
  await session.appendEvent({ type: 'workspace', path: rootDir, at: Date.now() });
}

/**
 * The workspace a session belongs to: the newest `workspace` marker in the
 * log; sessions created before the marker existed fall back to the `cwd=`
 * line of their seeded `<environment>` fragment.
 */
export function sessionWorkspace(session: Session): string | undefined {
  for (let i = session.events.length - 1; i >= 0; i--) {
    const evt = session.events[i];
    if (evt !== undefined && evt.type === 'workspace') return evt.path;
  }
  for (const msg of session.allMessages()) {
    if (msg.role !== 'user' || !msg.content.startsWith('<environment>')) continue;
    const match = /^cwd=(.+)$/m.exec(msg.content);
    return match?.[1]?.trim();
  }
  return undefined;
}

/**
 * True when `dir` points inside the nova data directory (sessions/skills/
 * cache live there): NEVER a valid workspace — a session accidentally
 * created inside the data dir must not drag the tools there.
 * (The predicate every session switcher and the surface rewrite all
 * share; `novaHome()` default keeps ~/.nova the single source.)
 */
export function isInsideNovaHome(dir: string, home = novaHome()): boolean {
  const rel = path.relative(home, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a session log path a surface was handed, or throw. The rule every
 * switcher obeys: a resume target must be a `.jsonl` INSIDE the sessions root,
 * so a hostile or mistaken path cannot point the session loader at an
 * arbitrary file (`../../secret.jsonl`, a directory, the root itself). Owned
 * here, next to the listing the same surfaces use — the check is a property of
 * the session store, not of whichever surface happened to receive the string.
 */
export function sessionLogPath(file: string, root: string = sessionsRoot()): string {
  const resolved = path.resolve(file);
  const rel = path.relative(root, resolved);
  if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel) || !resolved.endsWith('.jsonl')) {
    throw new Error('resume path is outside the sessions dir');
  }
  return resolved;
}
