/**
 * The 终端 tab's frames: open/resize/feed a real PTY, end the terminal.
 *
 * The pty itself (spawn, ring, tree-kill) is `term-session.ts`; this module is
 * the four rules around it that belong to the WIRE rather than to the process:
 *
 *  - **One terminal per session, spawned on first open.** A reader who never
 *    opens the tab never gets a process; the controller takes the previous
 *    session's pty down at the same point it replaces the session.
 *  - **Open answers with a RESET replay.** The client's emulator is blank on
 *    mount/reload, so the answer carries the whole retained scrollback with
 *    `reset: true` — feed it, do not append it. After that, output is PUSHED as
 *    deltas to every attached client (two tabs watch the same terminal).
 *  - **A spawn failure is an answer on the same frame** (`unavailable` +
 *    `error`), not an error frame, and not a crash: the missing native addon
 *    or a shell that is not installed is the terminal's own state, and the
 *    next open retries (lazy import makes the failure per-attempt, cheap).
 *  - **Killed ≠ exited ≠ unavailable.** `term_kill` ends the tree and
 *    broadcasts a reset; the panel's restart gesture is kill-then-open, which
 *    keeps ONE respawn rule in the registry (never silently replace an exited
 *    pty — its scrollback is the last reading the reader needs).
 */
import { ptyInvocation } from '@nova-agent/plugins';
import type { ShellCandidate } from '@nova-agent/plugins';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { TermRegistry, TermSession } from './term-session.js';
import type { WsConnection } from './ws.js';

/** The terminal frames this module answers. */
export type TermFrame = Extract<ClientFrame, { type: 'term_open' | 'term_input' | 'term_resize' | 'term_kill' }>;

/** The frame names this module owns, for the router's dispatch. */
export const TERM_FRAME_TYPES: readonly TermFrame['type'][] = ['term_open', 'term_input', 'term_resize', 'term_kill'];

/** What these frames need from the controller. */
export interface TermHost {
  /** The live terminals, one per session. */
  terms: TermRegistry;
  /** The live session — the terminal's owner and its workspace's reader. */
  sessionId: string;
  /** The workspace a freshly spawned pty starts in. */
  rootDir: string;
  /**
   * The shell this session's terminal starts in — a discovered candidate, not
   * a name. The panel follows the ENVIRONMENT's default (`panelShell`), which
   * is deliberately not the model's shell: the operator's terminal is theirs.
   */
  shell: ShellCandidate;
  /** Send every attached client this text (a broadcast, not a reply). */
  broadcast: (text: string) => void;
}

/**
 * The shell a `term_open` asked for, checked against what the host has.
 *
 * A path arriving on the wire is DATA: it is only ever spawned when it matches
 * an entry the host itself discovered (case-insensitively on Windows, where the
 * same executable is reported with different casing by different callers). No
 * match is a refusal, not a fallback — silently starting a different shell than
 * the reader picked would make the panel's checkmark a lie.
 * @param candidates - the host's discovered shells.
 * @param wanted - the path from the frame, or undefined for "no choice made".
 * @param fallback - the environment's own default.
 * @returns the candidate to spawn, or undefined when the request is unknown.
 */
export function matchShell(
  candidates: readonly ShellCandidate[], wanted: string | undefined, fallback: ShellCandidate,
): ShellCandidate | undefined {
  if (wanted === undefined) return fallback;
  const needle = wanted.toLowerCase();
  return candidates.find((item) => item.path.toLowerCase() === needle);
}

/**
 * Route one terminal frame. Async because the first open pays the pty's
 * spawn (the lazy `node-pty` import is awaited there); every other path is
 * synchronous work behind an already-resolved session.
 * @param client - the socket the frame arrived on (open replies go here).
 * @param frame - the validated frame.
 * @param host - the controller's own collaborators.
 */
export async function handleTermFrame(client: WsConnection, frame: TermFrame, host: TermHost): Promise<void> {
  switch (frame.type) {
    case 'term_open': {
      let session: TermSession;
      try {
        session = await ensureTerm(host, frame.cols, frame.rows);
      } catch (err) {
        // A spawn failure is an answer on the same frame shape, to the asking
        // client only: the missing native addon or absent shell is THIS
        // reader's question, and the next open retries (lazy import has no
        // sticky failure state).
        const message = err instanceof Error ? err.message : String(err);
        client.send(serialize({ type: 'term', data: '', status: 'unavailable', error: message }));
        return;
      }
      client.send(serialize({
        type: 'term',
        data: session.scrollback(),
        reset: true,
        status: session.status,
        ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {}),
      }));
      return;
    }
    case 'term_input': {
      // Before the first open resolves there is no session to feed — dropping
      // the keystroke is correct, not a race to paper over: the panel only
      // accepts input once the emulator (and therefore the open) is live.
      host.terms.get(host.sessionId)?.write(frame.data);
      return;
    }
    case 'term_resize': {
      host.terms.get(host.sessionId)?.resize(frame.cols, frame.rows);
      return;
    }
    case 'term_kill': {
      host.terms.dispose(host.sessionId);
      // The next `term_open` spawns a fresh one (the ring died with the
      // process); `reset` tells every emulator to clear along with the word.
      host.broadcast(serialize({ type: 'term', data: '', reset: true, status: 'exited' }));
      return;
    }
  }
}

/**
 * The session's terminal, spawning it on first use.
 * @param host - the controller's collaborators.
 * @param cols - the asking emulator's width, so the pty is born at the right size.
 * @param rows - the asking emulator's height.
 * @throws whatever the spawner throws (missing addon, missing shell) — the
 *   caller reports it as an `unavailable` answer.
 */
async function ensureTerm(host: TermHost, cols: number, rows: number): Promise<TermSession> {
  const existing = host.terms.get(host.sessionId);
  if (existing !== undefined) return existing;
  const { file, args } = ptyInvocation(host.shell);
  return await host.terms.ensure(
    host.sessionId,
    { file, args, cwd: host.rootDir, cols, rows },
    (chunk) => { host.broadcast(serialize({ type: 'term', data: chunk, status: 'running' })); },
    (exitCode) => {
      host.broadcast(serialize({
        type: 'term',
        data: '',
        status: 'exited' as const,
        ...(exitCode !== undefined ? { exitCode } : {}),
      }));
    },
  );
}
