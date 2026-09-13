import { appendFile, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newId } from './ids.js';
import type { AgentMessage, UserMessage } from './types.js';

/**
 * Session log format v2: the file is an append-only event stream, not a
 * message transcript. "Model-visible means logged" — every message the model
 * sees is a logged `message` event, and compaction NEVER rewrites history:
 * it appends log-only events and the model-visible surface is *projected*
 * (dsh-style surface replacement). Replay, resume, audits and telemetry all
 * derive from this one stream.
 */
export const SESSION_VERSION = 2;

export interface SessionHeader {
  type: 'session';
  v: number;
  id: string;
  createdAt: number;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export type SessionEvent =
  | { type: 'message'; message: AgentMessage }
  | { type: 'compaction/start'; trigger: 'auto' | 'manual'; at: number }
  | {
      type: 'compaction/summary';
      /** Full handoff summary text; the projection synthesizes the marker message from it. */
      summary: string;
      /** Indices into the full message-event stream kept verbatim on the surface (fragment first, then recents). */
      keep: number[];
      /**
       * Message ids of the kept entries (same set as `keep`, written alongside
       * since M7.8). When present, the projection resolves by ID — a corrupt
       * middle line shifts positional indices, and id resolution keeps the
       * restored surface aligned with what was actually kept.
       */
      keepIds?: string[];
      /** Estimated token count of the replaced surface. */
      shadowedTokenCount: number;
      at: number;
    }
  | { type: 'compaction/end'; at: number; error?: string }
  /** Log-only durable todo snapshot; never joins the model surface. */
  | { type: 'todo/write'; todos: TodoItem[]; at: number }
  /** Log-only approval audit pair record; never joins the model surface. */
  | { type: 'approval'; toolName: string; kind: string; outcome: 'allow' | 'deny' | 'always'; at: number }
  /** Log-only workspace marker (session switching restores the tools' root
   * from it); never joins the model surface. */
  | { type: 'workspace'; path: string; at: number }
  /**
   * Log-only PTC sub-dispatch audit record: one per settled `run_code`
   * binding call (dsh tool/code-dispatch). The only durable trace of what a
   * program actually did — intermediate results never enter the model
   * surface, so without this record a PTC turn would be unreconstructable.
   * Args and result are preview-capped string copies; the byte budgets keep
   * a program's fan-out from flooding the log.
   */
  | {
      type: 'code-dispatch';
      toolName: string;
      argsPreview: string;
      isError: boolean;
      resultPreview: string;
      at: number;
    };

/** The exported prefix used by the projected compaction summary message. */
export const COMPACT_SUMMARY_PREFIX = '[已压缩的上一会话摘要]';

/**
 * Deterministic summary message synthesized from a compaction/summary event.
 * Both the live compaction path and the replay projection construct the SAME
 * message through this helper, so the surface is byte-identical after resume.
 */
export function compactionSummaryMessage(summary: string, seq: number, at: number): UserMessage {
  return {
    id: `msg_compact_${seq}`,
    ts: at,
    role: 'user',
    content: `${COMPACT_SUMMARY_PREFIX}\n${summary}`,
  };
}

/**
 * The ONE implementation of "surface after this compaction" = kept originals
 * + the synthesized summary message. The live compaction path (cli/compact)
 * and the replay projection (deriveMessages) both go through here, so the
 * two never drift — previously the live path resolved `keep` positionally
 * while the projection preferred `keepIds`, and the "model-visible means
 * logged" invariant leaned on a dev-only divergence check.
 */
export function compactionSurface(
  evt: Extract<SessionEvent, { type: 'compaction/summary' }>,
  all: AgentMessage[],
  seq: number,
): AgentMessage[] {
  return [...resolveKeptMessages(evt, all), compactionSummaryMessage(evt.summary, seq, evt.at)];
}

function parseEventLine(line: string): SessionEvent {
  return JSON.parse(line) as SessionEvent;
}

/**
 * Resolve a compaction/summary event's kept entries against the full message
 * stream. `keepIds` (written since M7.8) is authoritative: a corrupt middle
 * line shifts positional indices, but ids pin the kept messages exactly —
 * a kept message lost to damage is simply omitted. Old logs without keepIds
 * fall back to the positional `keep` indices.
 */
function resolveKeptMessages(
  evt: Extract<SessionEvent, { type: 'compaction/summary' }>,
  all: AgentMessage[],
): AgentMessage[] {
  if (evt.keepIds !== undefined) {
    const byId = new Map(all.map((msg) => [msg.id, msg] as const));
    return evt.keepIds.map((id) => byId.get(id)).filter((msg): msg is AgentMessage => msg !== undefined);
  }
  return evt.keep.map((index) => all[index]).filter((msg): msg is AgentMessage => msg !== undefined);
}

/**
 * Index of the LAST unmatched compaction/start (an orphaned lock from a crash
 * mid-compaction), or -1 when every compaction is properly closed.
 */
function findOrphanCompaction(events: SessionEvent[]): number {
  let open = -1;
  for (let i = 0; i < events.length; i++) {
    const evt = events[i]!;
    if (evt.type === 'compaction/start') open = i;
    else if (evt.type === 'compaction/end') open = -1;
  }
  return open;
}

/**
 * Append-only JSONL session event log. v1 files (bare message lines) are
 * atomically upgraded to v2 on open; everything after that is v2-only.
 */
export class Session {
  readonly file: string;
  readonly id: string;
  readonly createdAt: number;
  /** Full loaded event stream; appended events land here and in the file. */
  readonly events: SessionEvent[] = [];
  /** Non-fatal problems noticed on open (e.g. orphaned compaction lock). */
  readonly warnings: string[] = [];

  private constructor(file: string, id: string, createdAt: number, events: SessionEvent[], warnings: string[]) {
    this.file = file;
    this.id = id;
    this.createdAt = createdAt;
    this.events.push(...events);
    this.warnings.push(...warnings);
  }

  static async create(dir: string, id: string = newId('sess')): Promise<Session> {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}.jsonl`);
    const createdAt = Date.now();
    const header: SessionHeader = { type: 'session', v: SESSION_VERSION, id, createdAt };
    await appendFile(file, `${JSON.stringify(header)}\n`, 'utf8');
    return new Session(file, id, createdAt, [], []);
  }

  static async open(file: string): Promise<Session> {
    const { header, events, warnings } = await readEvents(file, { repairTail: true });
    if (header.v < SESSION_VERSION) {
      await upgradeToV2(file, header, events);
    }
    if (findOrphanCompaction(events) !== -1) {
      warnings.push('检测到未完成的压缩（孤儿锁）：该次压缩被丢弃，历史消息保持完整。');
    }
    return new Session(file, header.id, header.createdAt, events, warnings);
  }

  /** Current header format version (v1 files report 2 after in-memory upgrade). */
  get version(): number {
    return SESSION_VERSION;
  }

  /** True while a compaction is open without its closing compaction/end. */
  get hasOpenCompaction(): boolean {
    return findOrphanCompaction(this.events) !== -1;
  }

  /** Append one raw event; returns its seq (index in the event stream). */
  async appendEvent(evt: SessionEvent): Promise<number> {
    // Disk first, memory second: if the write throws (full disk, killed
    // mid-flush), in-memory state still matches what a resume will replay
    // instead of diverging with a phantom event that never hit the log.
    await appendFile(this.file, `${JSON.stringify(evt)}\n`, 'utf8');
    this.events.push(evt);
    return this.events.length - 1;
  }

  /** Sugar for appending a model-visible message event. */
  async append(message: AgentMessage): Promise<void> {
    await this.appendEvent({ type: 'message', message });
  }

  /** Every message event ever logged, in order (NOT the model surface). */
  allMessages(): AgentMessage[] {
    return this.events.filter((evt): evt is Extract<SessionEvent, { type: 'message' }> => evt.type === 'message').map(
      (evt) => evt.message,
    );
  }

  /**
   * Project the model-visible surface from the log. An incomplete compaction
   * (orphaned lock) is discarded wholesale: everything from the unmatched
   * compaction/start on is ignored, so history stays complete and the crash
   * degrades to "compaction never happened".
   */
  deriveMessages(): AgentMessage[] {
    const orphan = findOrphanCompaction(this.events);
    const effective = orphan === -1 ? this.events : this.events.slice(0, orphan);

    const all: AgentMessage[] = [];
    let surface: AgentMessage[] = [];
    for (const evt of effective) {
      if (evt.type === 'message') {
        all.push(evt.message);
        surface.push(evt.message);
        continue;
      }
      if (evt.type === 'compaction/summary') {
        // Replace the whole surface: kept originals (context fragment, recent
        // user messages) plus the synthesized summary message — the SAME
        // construction the live compaction path uses (compactionSurface).
        surface = compactionSurface(evt, all, this.events.indexOf(evt));
      }
    }
    return surface;
  }

  /** Latest durable todo snapshot, or undefined when none was written. */
  latestTodos(): TodoItem[] | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const evt = this.events[i]!;
      if (evt.type === 'todo/write') return evt.todos;
    }
    return undefined;
  }

  /**
   * One-shot read helper (tests / audit tooling): open a log file and return
   * its header plus the raw message stream — NOT the projected surface (use
   * `open()` + `deriveMessages()` for that).
   */
  static async replay(file: string): Promise<{ header: SessionHeader; messages: AgentMessage[] }> {
    const { header, events } = await readEvents(file);
    const messages: AgentMessage[] = [];
    for (const evt of events) {
      if (evt.type === 'message') messages.push(evt.message);
    }
    return { header, messages };
  }
}

interface ReadResult {
  header: SessionHeader;
  events: SessionEvent[];
  warnings: string[];
}

/**
 * Read the JSONL session log with corruption tolerance. Two failure shapes
 * are handled:
 * - a truncated FINAL line (a crash between write() and the trailing
 *   newline): dropped and the file truncated at the damage point, so future
 *   appends line up and the log stays clean JSONL;
 * - a corrupt MIDDLE line (real disk damage): skipped with a warning, the
 *   rest of the log stays intact and every other consumer keeps replaying.
 * Without either tolerance a single bad line would make the session
 * unopenable — no resume, no audit, no recovery (codex repairs its rollout
 * logs for the same reason).
 */
async function readEvents(file: string, opts?: { repairTail?: boolean }): Promise<ReadResult> {
  const raw = await readFile(file, 'utf8');
  const warnings: string[] = [];
  const lines = raw.split('\n');
  const headerLine = lines[0];
  if (headerLine === undefined) throw new Error(`empty session file: ${file}`);
  let header: SessionHeader;
  try {
    const parsed = JSON.parse(headerLine) as SessionHeader;
    if (parsed.type !== 'session') throw new Error('not a session header');
    header = parsed;
  } catch {
    throw new Error(`not a session file: ${file}`);
  }

  const events: SessionEvent[] = [];
  // Byte offset of the first body line — the loop below starts at i=1, so
  // the header's own bytes (and its newline) seed the offset bookkeeping.
  let offset = Buffer.byteLength(headerLine, 'utf8') + 1;
  let truncatedTailOffset: number | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const isFinal = i === lines.length - 1;
    const endsWithNewline = !isFinal || raw.endsWith('\n');
    const lineStart = offset;
    offset += Buffer.byteLength(line, 'utf8') + (endsWithNewline ? 1 : 0);
    if (line.trim().length === 0) continue;
    try {
      if (header.v >= SESSION_VERSION) {
        events.push(parseEventLine(line));
      } else {
        // v1: bare message lines.
        const message = JSON.parse(line) as AgentMessage;
        events.push({ type: 'message', message });
      }
    } catch {
      if (isFinal && !endsWithNewline && opts?.repairTail === true) {
        truncatedTailOffset ??= lineStart;
      } else {
        warnings.push(`跳过损坏的事件行（第 ${i + 1} 行）；该行相关消息可能不完整。`);
      }
    }
  }

  if (truncatedTailOffset !== undefined) {
    // Drop the half-written line: the file now ends exactly at the previous
    // line's newline, so appends continue cleanly from here.
    const fh = await open(file, 'r+');
    try {
      await fh.truncate(truncatedTailOffset);
    } finally {
      await fh.close();
    }
  } else if (!raw.endsWith('\n')) {
    // A valid final line without a trailing newline (some external writer):
    // the next append would glue onto it and corrupt two lines at once.
    await appendFile(file, '\n', 'utf8');
  }
  return { header, events, warnings };
}

/**
 * One-time atomic v1 → v2 upgrade: write the wrapped event stream to a temp
 * file next to the original, then rename over it. A crash before the rename
 * leaves the v1 file (and a stray tmp file) untouched; the next open retries.
 */
async function upgradeToV2(file: string, header: SessionHeader, events: SessionEvent[]): Promise<void> {
  const v2Header: SessionHeader = { ...header, v: SESSION_VERSION };
  const body = events.map((evt) => JSON.stringify(evt)).join('\n');
  const tmp = `${file}.upgrade-${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(v2Header)}\n${body}${body.length > 0 ? '\n' : ''}`, 'utf8');
  await rename(tmp, file);
}
