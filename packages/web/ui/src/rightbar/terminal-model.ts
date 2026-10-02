/**
 * 终端: the panel's reading of the host's real PTY.
 *
 * The host keeps ONE pty per session (`web/src/term-session.ts`); output is
 * raw terminal bytes the browser emulator interprets, so the reducer does NOT
 * render text — it only forwards each frame's payload to the emulator through
 * a monotonically-fed `feed` slot (the view consumes it by `seq`). Status,
 * exit code and the spawn refusal are the fold's own readings.
 *
 * `session` is carried for the same reason the jobs slice carries it: the
 * host's pty belongs to a session, so a panel that kept the previous
 * session's terminal after a switch would be feeding keystrokes to a process
 * the reader can no longer see.
 */
import { RIGHTBAR_COPY } from './copy.js';

/** One `term` frame's payload (the wire frame minus its discriminant). */
export interface TermFrame {
  /** Raw pty bytes ('' when nothing new arrived). */
  data: string;
  /** The emulator must clear before writing this data (a replay). */
  reset?: boolean;
  status: 'running' | 'exited' | 'unavailable';
  exitCode?: number;
  error?: string;
}

/** The panel's own view of life: before the first open, plus the host's states. */
export type TermLife = 'off' | TermFrame['status'];

/**
 * Most characters the panel holds for an emulator that is not attached.
 *
 * The host keeps 256 KiB of scrollback (`web/src/term-session.ts`); holding
 * more than the ring means the ring's tail is the better reconstruction, so
 * past this bound the slot drops its bytes and says so (`overflow`) rather
 * than growing without bound while the tab is closed.
 */
export const TERM_FEED_LIMIT = 256 * 1024;

export interface TermState {
  status: TermLife;
  /** The pty's exit code, once it has one. */
  exitCode?: number;
  /** Why the terminal could not be opened (spawn refusal). */
  error?: string;
  /**
   * The bytes owed to the emulator, and the number it has caught up with.
   * `overflow` means the bytes the slot would have held were dropped (see
   * `TERM_FEED_LIMIT`), so the view must re-read the host's ring instead.
   */
  feed: { data: string; reset: boolean; seq: number; overflow?: boolean } | null;
  /** The session log this terminal belongs to. */
  session: string;
}

export const emptyTerm: TermState = { status: 'off', feed: null, session: '' };

/**
 * The panel's state for one session: itself when the session is unchanged, an
 * un-opened terminal when the reader switched sessions.
 * @param state - the panel's state.
 * @param sessionFile - the log the kernel is now attached to.
 * @returns the state to draw, stamped with the session it describes.
 */
export function termForSession(state: TermState, sessionFile: string): TermState {
  if (state.session === sessionFile) return state;
  return { ...emptyTerm, session: sessionFile };
}

/**
 * Fold one `term` frame in.
 *
 * The bytes go to `feed` untouched — deduplicating here would mean parsing
 * terminal sequences in the reducer, and the emulator at the other end is
 * exactly the thing that knows what to do with them. `seq` rises with each
 * owed batch so the view can tell a repeat from new bytes without keeping its
 * own copy of the screen.
 *
 * The slot ACCUMULATES: frames are folded as they arrive and consumed at
 * render rate, and several can land between two renders (the socket delivers
 * bursts, React batches the dispatches). Keeping only the last frame silently
 * dropped the middle of an ANSI stream — a truncated escape paints as junk
 * where the screen should have text, so the "garbled terminal" was real even
 * though every byte on the wire was clean. A later `reset` frame discards the
 * bytes it will clear anyway, so the batch stays exactly what sequential
 * `reset`+`write` calls would have produced.
 * @param state - the panel's state before the frame.
 * @param frame - the frame's payload.
 * @returns the state after it.
 */
export function applyTerm(state: TermState, frame: TermFrame): TermState {
  const owed = frame.data.length > 0 || frame.reset === true;
  const previous = state.feed;
  let feed = previous;
  if (owed) {
    const data = frame.reset === true ? frame.data : (previous?.data ?? '') + frame.data;
    const overflow = data.length > TERM_FEED_LIMIT;
    feed = {
      data: overflow ? '' : data,
      reset: frame.reset === true || (previous?.reset ?? false),
      seq: (previous?.seq ?? 0) + 1,
      ...(overflow ? { overflow: true } : {}),
    };
  }
  // An error describes the LAST attempt. Bytes arriving means the terminal
  // moved on, so the line goes; a frame that states one replaces it; a
  // state-only frame leaves it standing.
  const error = frame.error ?? (frame.data.length > 0 ? undefined : state.error);
  return {
    status: frame.status,
    ...(frame.exitCode !== undefined ? { exitCode: frame.exitCode } : { exitCode: state.exitCode }),
    ...(error !== undefined ? { error } : {}),
    feed,
    session: state.session,
  };
}

/** The status word the panel's head carries. */
export function termStatusWord(state: TermState): string {
  if (state.status === 'running') return RIGHTBAR_COPY['term.running'];
  if (state.status === 'unavailable') return RIGHTBAR_COPY['term.unavailable'];
  if (state.status === 'off') return RIGHTBAR_COPY['term.off'];
  return state.exitCode === undefined
    ? RIGHTBAR_COPY['term.exited']
    : RIGHTBAR_COPY['term.code'].replace('{code}', String(state.exitCode));
}
