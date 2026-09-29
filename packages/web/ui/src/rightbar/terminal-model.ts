/**
 * The 终端 tab's model: the commands this panel ran, their output so far, and
 * which of them are still running.
 *
 * The frames are an upsert keyed by job id (`terminal`), so this is a fold with
 * one rule that matters: **text appends, state replaces**. A poll that arrives
 * after the command settled carries the last chunk AND the new status; treating
 * either as a whole replacement would drop output, and treating both as
 * accumulations would corrupt the status word.
 *
 * The panel is honest about what it is: a command submitted once, run in the
 * session's workspace, with no stdin — see `packages/web/src/terminal-frames.ts`
 * for the host half of that contract. Nothing here implies an interactive shell,
 * and the empty state says so out loud.
 */
import type { JobStatus } from '@nova-agent/core';
import type { ServerFrame } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';

/**
 * One `terminal` frame's payload: the wire frame minus its discriminant (the
 * panel folds payloads, and the frame's `type` says nothing the id does not).
 */
export type TerminalFrameState = Omit<Extract<ServerFrame, { type: 'terminal' }>, 'type'>;

/** One command the panel ran. */
export interface TerminalJob {
  /** The registry's job id (`bash-3`). */
  id: string;
  /** The command line, exactly as it was submitted. */
  command: string;
  status: JobStatus;
  /** Everything read so far, oldest first (the panel's own screen). */
  text: string;
  /** Producer detail once it settled (`exit code: 0`). */
  detail?: string;
}

export interface TerminalState {
  /** Commands in submission order; the newest is last (the prompt's end). */
  jobs: readonly TerminalJob[];
  /** The panel's own refusal line (a spawn the host would not start), or null. */
  error: string | null;
  /**
   * The session log these commands belong to.
   *
   * Jobs are owned by a session on the host, so a panel that kept the previous
   * session's rows after a switch would show commands it can no longer read (and
   * whose poll answers would be refusals). Carrying the owner here is what lets
   * {@link terminalForSession} drop them at the switch instead of at the first
   * failed poll.
   */
  session: string;
}

export const emptyTerminal: TerminalState = { jobs: [], error: null, session: '' };

/**
 * The panel's state for one session: itself when the session is unchanged, an
 * empty one when the reader switched sessions.
 * @param state - the panel's state.
 * @param sessionFile - the log the kernel is now attached to.
 * @returns the state to draw, stamped with the session it describes.
 */
export function terminalForSession(state: TerminalState, sessionFile: string): TerminalState {
  if (state.session === sessionFile) return state;
  return { jobs: [], error: null, session: sessionFile };
}

/**
 * Fold one `terminal` frame into the panel's state.
 * @param state - the panel's state before the frame.
 * @param frame - the frame's payload (see `terminal-types.ts`).
 * @returns the state with the job upserted; an empty id is a refusal line.
 */
export function upsertTerminal(state: TerminalState, frame: TerminalFrameState): TerminalState {
  if (frame.id === '') return { jobs: state.jobs, error: frame.error ?? null, session: state.session };
  const index = state.jobs.findIndex((job) => job.id === frame.id);
  if (index < 0) {
    return {
      jobs: [
        ...state.jobs,
        {
          id: frame.id,
          command: frame.command,
          status: frame.status,
          text: frame.text,
          ...(frame.detail !== undefined ? { detail: frame.detail } : {}),
        },
      ],
      error: null,
      session: state.session,
    };
  }
  const previous = state.jobs[index] as TerminalJob;
  const next: TerminalJob = {
    id: previous.id,
    // An answer that carries no command (a refusal for a known id) must not
    // blank the line the reader is looking at.
    command: frame.command.length > 0 ? frame.command : previous.command,
    status: frame.status,
    text: previous.text + frame.text,
    ...(frame.detail !== undefined ? { detail: frame.detail } : {}),
  };
  const jobs = [...state.jobs];
  jobs[index] = next;
  return { jobs, error: frame.error ?? null, session: state.session };
}

/**
 * The jobs a poll should ask about: the ones whose producer is still writing.
 * `stopping` is included because the kill has been requested but the output ring
 * can still receive the dying process's last bytes.
 * @param state - the panel's state.
 */
export function runningIds(state: TerminalState): string[] {
  return state.jobs.filter((job) => job.status === 'running' || job.status === 'stopping').map((job) => job.id);
}

/** The status word a job's line carries. */
export const TERMINAL_STATUS_WORDS: Record<TerminalJob['status'], string> = {
  running: RIGHTBAR_COPY['terminal.running'],
  stopping: RIGHTBAR_COPY['terminal.stopping'],
  completed: RIGHTBAR_COPY['terminal.completed'],
  killed: RIGHTBAR_COPY['terminal.stopped'],
  failed: RIGHTBAR_COPY['terminal.failed'],
};
