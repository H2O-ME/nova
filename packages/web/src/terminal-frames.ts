/**
 * The right panel's terminal frames: run one shell command, drain its output,
 * and re-list what is still running.
 *
 * **This is not a PTY.** The host runs the command once in the session's
 * workspace as an ordinary background job (`kernel.jobs`), streams its output
 * through the job registry's byte-capped ring, and answers each poll with only
 * what arrived since the previous one. There is no stdin, no window size and no
 * signal channel beyond the existing `stop_job` frame. That is the honest
 * boundary of what this surface can do without a persistent-terminal
 * implementation behind it — and it is enough for the thing the panel is for
 * (run a command here, watch it print, stop it).
 *
 * Two consequences worth stating, because they are contracts rather than
 * implementation notes:
 *  - **A read is a cursor move.** `read_terminal` consumes output (the registry's
 *    `readOutput` contract), so the panel and the model's `jobs output` would
 *    share one cursor if both read the same job. Only jobs THIS panel started
 *    are readable here (the ledger below), which keeps the two readers from
 *    eating each other's output.
 *  - **Ownership is the session's.** Commands are stamped with the live
 *    session's id, so they are hidden from other sessions, cancelled when the
 *    session is disposed, and disposed with the process like any other job.
 */
import type { JobRegistry, JobSnapshot, JobStatus } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame, ServerFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/**
 * Bytes one poll may carry. The panel polls while a command runs, so this is a
 * per-answer budget rather than a retention budget: a chatty build must not put
 * megabytes on the socket every few hundred milliseconds.
 */
export const TERMINAL_READ_BYTES = 64 * 1024;

/** The terminal frames this module answers. */
export type TerminalFrame = Extract<
  ClientFrame,
  { type: 'run_terminal' } | { type: 'read_terminal' } | { type: 'list_terminal' }
>;

/** The frame names this module owns, for the router's dispatch. */
export const TERMINAL_FRAME_TYPES: readonly TerminalFrame['type'][] = [
  'run_terminal',
  'read_terminal',
  'list_terminal',
];

/**
 * Which background jobs the terminal panel started, per session.
 *
 * This is the marker that keeps the panel's reader separate from the model's:
 * the registry itself cannot tell the two apart (both are `kind: 'bash'`), and
 * an id from anywhere else must not be readable here — `read_terminal` on a
 * model-started job would consume output the model was told to read.
 *
 * Process-scoped, and deliberately so: the ids are job ids, which exist only for
 * as long as this process does. A settled job is dropped (its output is no
 * longer growing), and a session's whole set goes with the session.
 */
export class TerminalLedger {
  private readonly bySession = new Map<string, Set<string>>();

  /**
   * Record a job this panel started.
   * @param sessionId - the owning session.
   * @param id - the job id the registry returned.
   */
  add(sessionId: string, id: string): void {
    const ids = this.bySession.get(sessionId);
    if (ids === undefined) this.bySession.set(sessionId, new Set([id]));
    else ids.add(id);
  }

  /**
   * Whether this panel may read the job.
   * @param sessionId - the asking session.
   * @param id - the job id from the wire.
   */
  has(sessionId: string, id: string): boolean {
    return this.bySession.get(sessionId)?.has(id) ?? false;
  }

  /**
   * The jobs this panel started in one session, in start order.
   * @param sessionId - the asking session.
   */
  ids(sessionId: string): string[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  /**
   * Forget one job (it settled, or it vanished with a process restart).
   * @param sessionId - the owning session.
   * @param id - the job id to forget.
   */
  drop(sessionId: string, id: string): void {
    const ids = this.bySession.get(sessionId);
    if (ids === undefined) return;
    ids.delete(id);
    if (ids.size === 0) this.bySession.delete(sessionId);
  }
}

/**
 * The panel's ledger for this process.
 *
 * One instance because there is one panel per process and its entries are job
 * ids that only this process minted; a second instance would be a second answer
 * to "may this reader drain that job".
 */
export const terminalLedger = new TerminalLedger();

/** What these frames need from the controller. */
export interface TerminalHost {
  /** The kernel's background-job registry: identity, status and output cursor. */
  jobs: JobRegistry;
  /** The live session, which owns every command started here. */
  sessionId: string;
  /**
   * Spawn one command as a background job. The real implementation is the bash
   * plugin's `startBashJob` (the same shell resolution and tree kill the model's
   * commands get); a test supplies its own, which is why this is injected rather
   * than imported here.
   * @param command - the command line, verbatim.
   * @returns the started job's snapshot, or a `Error: …` message to show.
   */
  start: (command: string) => JobSnapshot | string;
  /** The panel-started job ledger (see {@link TerminalLedger}). */
  ledger: TerminalLedger;
}

/**
 * Route one terminal frame.
 * @param client - the socket the frame arrived on (replies go here).
 * @param frame - the validated terminal frame.
 * @param host - the controller's own collaborators.
 * @returns nothing; every answer is a `terminal` frame on this client.
 */
export function handleTerminalFrame(client: WsConnection, frame: TerminalFrame, host: TerminalHost): void {
  switch (frame.type) {
    case 'run_terminal': {
      const started = host.start(frame.command);
      if (typeof started === 'string') {
        send(client, { id: '', command: frame.command, status: 'failed', text: '', error: started });
        return;
      }
      host.ledger.add(host.sessionId, started.id);
      send(client, terminalOf(started, ''));
      return;
    }
    case 'read_terminal': {
      if (!host.ledger.has(host.sessionId, frame.id)) {
        // "Not yours" folds into "unknown", the same way the registry folds a
        // foreign job into a missing one: the panel cannot probe job ids it did
        // not start, and the reader gets the same sentence either way.
        send(client, { id: frame.id, command: '', status: 'failed', text: '', error: `未知的终端任务：${frame.id}` });
        return;
      }
      const snapshot = host.jobs.get(frame.id, host.sessionId);
      if (snapshot === undefined) {
        host.ledger.drop(host.sessionId, frame.id);
        send(client, { id: frame.id, command: '', status: 'failed', text: '', error: `终端任务已不存在：${frame.id}` });
        return;
      }
      const text = host.jobs.readOutput(frame.id, TERMINAL_READ_BYTES, host.sessionId) ?? '';
      if (settled(snapshot.status)) host.ledger.drop(host.sessionId, frame.id);
      send(client, terminalOf(snapshot, text));
      return;
    }
    case 'list_terminal': {
      // The rebuild path: a reloaded page asks what it still owns. Text is empty
      // because a fresh client has nothing yet; the next poll brings the tail.
      for (const id of host.ledger.ids(host.sessionId)) {
        const snapshot = host.jobs.get(id, host.sessionId);
        if (snapshot === undefined) {
          host.ledger.drop(host.sessionId, id);
          continue;
        }
        send(client, terminalOf(snapshot, ''));
      }
      return;
    }
  }
}

/** Whether a status means the producer has stopped writing output. */
function settled(status: JobStatus): boolean {
  return status !== 'running' && status !== 'stopping';
}

/** One job snapshot → the frame the panel upserts by id. */
function terminalOf(snapshot: JobSnapshot, text: string): TerminalPayload {
  return {
    id: snapshot.id,
    command: snapshot.label,
    status: snapshot.status,
    text,
    ...(snapshot.detail !== undefined ? { detail: snapshot.detail } : {}),
  };
}

/** The frame's payload without its discriminant (the sender adds `terminal`). */
type TerminalPayload = Omit<Extract<ServerFrame, { type: 'terminal' }>, 'type'>;

/** Send one terminal frame. */
function send(client: WsConnection, payload: TerminalPayload): void {
  client.send(serialize({ type: 'terminal', ...payload }));
}
