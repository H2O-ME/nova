import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from '@nova-agent/core';

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

/**
 * Sessions under the date-bucketed root (`YYYY/MM/DD/<id>.jsonl`), the most
 * recently written first. Titles are only peeked for the top `limit` entries.
 */
export async function listRecentSessions(root: string, limit: number): Promise<SessionEntry[]> {
  const files = await walkSessionFiles(root);
  const statted = await Promise.all(files.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })));
  statted.sort((a, b) => b.mtime - a.mtime);
  return Promise.all(
    statted.slice(0, Math.max(0, limit)).map(async ({ file, mtime }) => {
      const peek = await peekSession(file);
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
    for (const line of buf.toString('utf8', 0, bytesRead).split('\n')) {
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
 * Append the log-only workspace marker so a later `/session` switch can
 * re-point the tools at the workspace the session was created in.
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
