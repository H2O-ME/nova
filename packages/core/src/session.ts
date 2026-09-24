import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { newId } from './ids.js';
import { readEvents, upgradeToV2 } from './session-log.js';
import type { RunStats } from './kernel/metrics.js';
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
    }
  /**
   * Log-only measurement of one run (the same numbers the live `run_stats`
   * event carries). Timing and throughput are the ONLY per-turn facts a reader
   * cannot re-derive from the messages, and they are measured once, in the run
   * loop — so without this record every resumed session would lose its per-turn
   * rows and its session totals. Never joins the model surface.
   */
  | {
      type: 'run/stats';
      stats: RunStats;
      /**
       * Id of the message the run ended on (the row anchor: the surface draws
       * these numbers right after that message). Absent when the run appended
       * no message at all — there is then nothing to anchor to.
       */
      afterMessageId?: string;
      at: number;
    };

/**
 * Each run's measurement, keyed by the message it closed (the anchor the log
 * itself carries). A surface draws those numbers right after that message; one
 * the projection no longer holds (compaction replaced it) simply keeps no row,
 * because re-anchoring a measurement would attribute it to a message it never
 * measured.
 */
export function anchoredRunStats(events: readonly SessionEvent[]): Map<string, RunStats> {
  const runs = new Map<string, RunStats>();
  for (const event of events) {
    if (event.type !== 'run/stats' || event.afterMessageId === undefined) continue;
    // Last write wins: a re-run of the same anchor is the one a reader saw last.
    runs.set(event.afterMessageId, event.stats);
  }
  return runs;
}

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

export function parseEventLine(line: string): SessionEvent {
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
