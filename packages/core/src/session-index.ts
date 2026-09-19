/**
 * Session enumeration and workspace markers (moved out of the CLI shell with
 * the M11 kernel lift): surfaces (TUI switcher, session picker, web sidebar)
 * and the assembly factory all need the same listing/titling rules, so they
 * live next to `Session` itself.
 */
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { novaHome } from './paths.js';
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
}

const TITLE_MAX_CHARS = 120;
/** Titles live in the first lines of the log; a capped read keeps listing
 * O(64KB) per file instead of loading whole (possibly multi-MB) sessions. */
const PEEK_BYTES = 64 * 1024;
/** Enumeration bound: a runaway sessions dir must not freeze the switcher. */
const MAX_SESSION_FILES = 2000;

/**
 * Sessions under the date-bucketed root (`YYYY/MM/DD/<id>.jsonl`), the most
 * recently written first. Titles are only peeked for the top `limit` entries.
 */
export async function listRecentSessions(root: string, limit: number): Promise<SessionEntry[]> {
  const files = await walkSessionFiles(root);
  const statted: { file: string; mtime: number }[] = [];
  for (const file of files) {
    const info = await stat(file).catch(() => undefined);
    if (info !== undefined) statted.push({ file, mtime: info.mtimeMs });
  }
  statted.sort((a, b) => b.mtime - a.mtime);
  return Promise.all(
    statted.slice(0, Math.max(0, limit)).map(async ({ file, mtime }) => {
      // One unreadable file (locked, deleted mid-listing, permissions) must
      // not blow up the whole panel — it just renders without id/title.
      const peek = await peekSession(file).catch(() => ({
        id: path.basename(file).replace(/\.jsonl$/, ''),
        createdAt: undefined,
        title: '',
      }));
      return { file, mtime, ...peek };
    }),
  );
}

async function walkSessionFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for (const year of await readdir(root)) {
      const yearDir = path.join(root, year);
      for (const month of await readdir(yearDir).catch(() => [] as string[])) {
        const monthDir = path.join(yearDir, month);
        for (const day of await readdir(monthDir).catch(() => [] as string[])) {
          const dayDir = path.join(monthDir, day);
          for (const name of await readdir(dayDir).catch(() => [] as string[])) {
            if (name.endsWith('.jsonl')) files.push(path.join(dayDir, name));
            if (files.length >= MAX_SESSION_FILES) return files;
          }
        }
      }
    }
  } catch {
    return []; // root does not exist yet — no sessions, not an error
  }
  return files;
}

async function peekSession(file: string): Promise<{ id: string; createdAt: number | undefined; title: string }> {
  const id = path.basename(file).replace(/\.jsonl$/, '');
  let createdAt: number | undefined;
  let title = '';
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(PEEK_BYTES);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    // The capped read can slice a multi-byte UTF-8 char at the boundary; the
    // decoder replaces it with U+FFFD in the tail line, whose JSON.parse then
    // fails and is skipped like any other read-capped partial line.
    const text = buf.subarray(0, bytesRead).toString('utf8');
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      let evt: unknown;
      try {
        evt = JSON.parse(line);
      } catch {
        continue; // a read-capped tail can end mid-line
      }
      if (typeof evt !== 'object' || evt === null) continue;
      const rec = evt as { type?: unknown; createdAt?: unknown; message?: unknown };
      if (rec.type === 'session') {
        if (typeof rec.createdAt === 'number') createdAt = rec.createdAt;
        continue;
      }
      if (rec.type !== 'message') continue;
      const msg = rec.message as { role?: unknown; content?: unknown } | undefined;
      if (msg === undefined || msg.role !== 'user') continue;
      const firstLine = (typeof msg.content === 'string' ? msg.content : '').split('\n', 1)[0] ?? '';
      // <environment> fragments and compaction summaries are runner-written
      // context, not user prompts.
      const trimmed = firstLine.trim();
      if (trimmed.startsWith('<') || trimmed.length === 0) continue;
      title = trimmed.slice(0, TITLE_MAX_CHARS);
      break;
    }
  } finally {
    await fh.close();
  }
  return { id, createdAt, title };
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
 * (The predicate the TUI/REPL session switchers and the surface rewrite all
 * share; `novaHome()` default keeps ~/.nova the single source.)
 */
export function isInsideNovaHome(dir: string, home = novaHome()): boolean {
  const rel = path.relative(home, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
