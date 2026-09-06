import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
  | { type: 'workspace'; path: string; at: number };

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

function parseEventLine(line: string): SessionEvent {
  return JSON.parse(line) as SessionEvent;
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
    const { header, events } = await readEvents(file);
    if (header.v < SESSION_VERSION) {
      await upgradeToV2(file, header, events);
    }
    const warnings: string[] = [];
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
    this.events.push(evt);
    await appendFile(this.file, `${JSON.stringify(evt)}\n`, 'utf8');
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
        // user messages) plus the synthesized summary message.
        const kept = evt.keep.map((index) => all[index]).filter((msg): msg is AgentMessage => msg !== undefined);
        surface = [...kept, compactionSummaryMessage(evt.summary, this.events.indexOf(evt), evt.at)];
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

  static async replay(file: string): Promise<{ header: SessionHeader; messages: AgentMessage[] }> {
    const { header, events } = await readEvents(file);
    const messages: AgentMessage[] = [];
    for (const evt of events) {
      if (evt.type === 'message') messages.push(evt.message);
    }
    return { header, messages };
  }
}

async function readEvents(file: string): Promise<{ header: SessionHeader; events: SessionEvent[] }> {
  const raw = await readFile(file, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) throw new Error(`empty session file: ${file}`);
  const header = JSON.parse(headerLine) as SessionHeader;
  if (header.type !== 'session') throw new Error(`not a session file: ${file}`);

  const events: SessionEvent[] = [];
  for (const line of lines.slice(1)) {
    if (header.v >= SESSION_VERSION) {
      events.push(parseEventLine(line));
      continue;
    }
    // v1: bare message lines.
    const message = JSON.parse(line) as AgentMessage;
    events.push({ type: 'message', message });
  }
  return { header, events };
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
