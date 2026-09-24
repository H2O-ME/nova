/**
 * Log-head scanning for the session list: everything a switcher row shows —
 * identity, creation time, title, the workspace the session was created in —
 * lives in the first lines of the JSONL log, so a capped read answers all of
 * it without loading whole (possibly multi-MB) sessions.
 *
 * Split from `session-index.ts` (the catalog API): the scan and the API change
 * for different reasons — this file moves when the log's head layout changes,
 * that one when the listing/enumeration contract does.
 */
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';

/** What a capped head scan can tell about one session log. */
export interface SessionPeek {
  id: string;
  createdAt: number | undefined;
  title: string;
  workspace: string | undefined;
}

const TITLE_MAX_CHARS = 120;
/** Titles live in the first lines of the log; a capped read keeps listing
 * O(64KB) per file instead of loading whole (possibly multi-MB) sessions. */
const PEEK_BYTES = 64 * 1024;
/** Enumeration bound: a runaway sessions dir must not freeze the switcher. */
const MAX_SESSION_FILES = 2000;

/** Every session log under the date-bucketed root, capped at `MAX_SESSION_FILES`. */
export async function listSessionFiles(root: string): Promise<string[]> {
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

/** Read one log's head for its id / creation time / title / workspace. */
export async function peekSession(file: string): Promise<SessionPeek> {
  const id = path.basename(file).replace(/\.jsonl$/, '');
  let createdAt: number | undefined;
  let title = '';
  // The workspace marker is appended at session creation (before the seeded
  // fragment), so the head scan finds it; older logs fall back to the
  // fragment's cwd= line, mirroring `sessionWorkspace`'s own fallback.
  let workspace: string | undefined;
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
      const rec = evt as { type?: unknown; createdAt?: unknown; message?: unknown; path?: unknown };
      if (rec.type === 'session') {
        if (typeof rec.createdAt === 'number') createdAt = rec.createdAt;
        continue;
      }
      if (rec.type === 'workspace') {
        if (typeof rec.path === 'string' && workspace === undefined) workspace = rec.path;
        continue;
      }
      if (rec.type !== 'message') continue;
      const msg = rec.message as { role?: unknown; content?: unknown } | undefined;
      if (msg === undefined || msg.role !== 'user') continue;
      const content = typeof msg.content === 'string' ? msg.content : '';
      const firstLine = content.split('\n', 1)[0] ?? '';
      const trimmed = firstLine.trim();
      // <environment> fragments and compaction summaries are runner-written
      // context, not user prompts — but the fragment names the workspace.
      if (trimmed.startsWith('<')) {
        if (workspace === undefined) {
          const cwd = /^cwd=(.+)$/m.exec(content)?.[1]?.trim();
          if (cwd !== undefined) workspace = cwd;
        }
        continue;
      }
      if (trimmed.length === 0) continue;
      title = trimmed.slice(0, TITLE_MAX_CHARS);
      break;
    }
  } finally {
    await fh.close();
  }
  return { id, createdAt, title, workspace };
}
