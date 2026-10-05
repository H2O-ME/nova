/**
 * The 终端 tab's backend: ONE real PTY per session, driven over node-pty.
 *
 * This replaced a pipe-based fake: the old host spawned the shell over stdio
 * pipes and split its output on injected markers, which honestly could not run
 * anything that checks for a terminal (an editor, a pager, `ssh`). A PTY is a
 * different animal — the shell believes it owns a real terminal, so the host's
 * entire job is three verbs: forward keystrokes in, forward bytes out, forward
 * the window size — and the emulator (xterm.js on the client) draws what comes
 * back. No markers, no stripping, no one-command-at-a-time rule.
 *
 * node-pty is loaded LAZILY (first use): it is a native addon, and this file
 * must stay importable on a host where the addon is absent — the spawn then
 * fails once with the loader's honest message (an `unavailable` terminal frame),
 * never with a module-load crash of the whole web server.
 *
 * Output is a raw ANSI byte stream kept in a bounded ring so a reloaded page
 * can rebuild the emulator from `scrollback()`. Chunk boundaries may split a
 * UTF-8 character (ConPTY hands over decoded strings, but a surrogate pair can
 * still land across one); `holdSplitSurrogate` parks the dangling high
 * surrogate until the next chunk completes it, because xterm renders an
 * unpaired surrogate as replacement junk that never repairs itself.
 */
import { spawn as spawnDetached } from 'node:child_process';

/** Chars of pty output kept for readers that fall behind or reload. */
export const TERM_SCROLLBACK_CHARS = 256 * 1024;

/** The terminal's life as the panel shows it (`unavailable` = spawn refused). */
export type TermStatus = 'running' | 'exited' | 'unavailable';

/** One pty's surface, narrowed from node-pty's IPty — tests supply a fake. */
export interface PtyHandle {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (exitCode: number | undefined) => void): void;
}

/** How launch one pty; the production implementation loads node-pty here. */
export type PtySpawner = (opts: {
  file: string;
  args: readonly string[];
  cwd: string;
  cols: number;
  rows: number;
}) => Promise<PtyHandle>;

/**
 * Keep the trailing half of a split surrogate pair out of the reader's stream.
 * @param pending - bytes received but not yet released.
 * @param flush - whether the producer is done (a dangling half must go out).
 * @returns what to release now, and what to prepend to the next chunk.
 */
export function holdSplitSurrogate(pending: string, flush: boolean): { text: string; rest: string } {
  if (flush || pending.length === 0) return { text: pending, rest: '' };
  const last = pending.charCodeAt(pending.length - 1);
  // A lone high surrogate (D800–DBFF) at the boundary is half a character.
  if (last >= 0xd800 && last <= 0xdbff) {
    return { text: pending.slice(0, -1), rest: pending.slice(-1) };
  }
  return { text: pending, rest: '' };
}

/** The production spawner: lazy-load the native addon and hand back its pty. */
export const nodePtySpawn: PtySpawner = async (opts) => {
  const pty = await import('node-pty');
  const proc = pty.spawn(opts.file, [...opts.args], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });
  return {
    pid: proc.pid,
    write: (data) => { proc.write(data); },
    resize: (cols, rows) => { proc.resize(cols, rows); },
    kill: () => { proc.kill(); },
    onData: (cb) => { proc.onData(cb); },
    onExit: (cb) => { proc.onExit((e) => { cb(typeof e.exitCode === 'number' ? e.exitCode : undefined); }); },
  };
};

/**
 * One session's live terminal.
 *
 * Owns the pty and the output ring; everything else — who may write, what gets
 * broadcast — is `term-frames.ts`. Output is forwarded to the broadcast VERBATIM
 * (minus split surrogates): this host does not parse terminal sequences, the
 * emulator on the far end of the socket does.
 */
export class TermSession {
  private text = '';
  /** The surrogate tail held back from the previous chunk, when one was split. */
  private pending = '';
  status: TermStatus = 'running';
  exitCode: number | undefined;

  /**
   * Adopt one already-spawned pty (the registry's spawn errors surface to the
   * caller instead — there is no half-built session to keep).
   * @param handle - the live pty.
   * @param onOutput - called per released chunk (post-surrogate-guard).
   * @param onExit - called once with the process's exit code.
   */
  constructor(
    private readonly handle: PtyHandle,
    onOutput: (chunk: string) => void,
    onExit: (exitCode: number | undefined) => void,
  ) {
    handle.onData((chunk) => {
      this.pending += chunk;
      const split = holdSplitSurrogate(this.pending, false);
      this.pending = split.rest;
      if (split.text.length === 0) return;
      this.absorb(split.text);
      onOutput(split.text);
    });
    handle.onExit((code) => {
      if (this.status === 'exited') return;
      // The producer is done: a held surrogate goes out as-is, replacement
      // character and all — nothing is coming to complete it.
      if (this.pending.length > 0) { this.absorb(this.pending); this.pending = ''; }
      this.status = 'exited';
      this.exitCode = code;
      onExit(code);
    });
  }

  /** The pty's child pid (tree-kill diagnostics). */
  get pid(): number {
    return this.handle.pid;
  }

  /** The retained scrollback (a reloaded page's emulator rebuild). */
  scrollback(): string {
    return this.text;
  }

  /** Forward keystrokes/paste. Silent when the process is gone (a race, not a bug). */
  write(data: string): void {
    if (this.status !== 'running') return;
    this.handle.write(data);
  }

  /** Resize the window; the pty raises SIGWINCH on the shell's next read. */
  resize(cols: number, rows: number): void {
    if (this.status !== 'running') return;
    try {
      this.handle.resize(cols, rows);
    } catch {
      // node-pty throws when the process died between the status check and the
      // resize; the exit event carries the real news, this frame is a no-op.
    }
  }

  /** Terminate the shell and its whole process tree. Idempotent. */
  kill(): void {
    if (this.status === 'exited') return;
    this.status = 'exited';
    killPtyTree(this.handle);
  }

  /** Append reader-visible bytes to the ring, evicting the head past the bound. */
  private absorb(text: string): void {
    this.text += text;
    if (this.text.length > TERM_SCROLLBACK_CHARS) {
      this.text = this.text.slice(this.text.length - TERM_SCROLLBACK_CHARS);
    }
  }
}

/**
 * Kill a pty's shell AND its whole tree.
 *
 * `handle.kill()` takes the shell; a `npm run dev` it started keeps running.
 * The same rule the bash tool applies to its own spawns (POSIX: the PTY leader
 * heads its own process group, so a negative-pid SIGKILL takes the group;
 * Windows: taskkill /T /F). The pty's own kill runs FIRST: on Windows the
 * native kill also tears down the ConPTY attachment, leaving taskkill to sweep
 * the process tree the console host was hosting.
 * @param handle - the live pty.
 */
export function killPtyTree(handle: PtyHandle): void {
  try {
    handle.kill();
  } catch {
    // Already dead — the tree sweep below is still worth running.
  }
  const pid = handle.pid;
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnDetached('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      handle.kill();
    } catch {
      // Gone already; nothing left to do.
    }
  }
}

/**
 * The live terminals, one per session.
 *
 * Keyed by session id because the terminal belongs to the session that opened
 * it: switching sessions must not leave a previous session's shell — with its
 * `cd` and its jobs — reachable from the new one.
 */
export class TermRegistry {
  private readonly bySession = new Map<string, TermSession>();
  /** Spawns in flight, keyed by session (concurrent opens share one). */
  private readonly spawning = new Map<string, Promise<TermSession>>();
  /**
   * Sessions whose spawn must NOT register when it lands: a `dispose` or
   * `retainOnly` that ran while the spawn was in flight. Without this, the
   * disposal "succeeded" (there was nothing in `bySession` yet) and the
   * late-arriving spawn re-registered a terminal nobody owned any more — an
   * orphaned shell that a later switch would not even find to kill.
   */
  private readonly cancelled = new Set<string>();

  constructor(private readonly spawnPty: PtySpawner = nodePtySpawn) {}

  /** How many terminals are alive (tests). */
  get size(): number {
    return this.bySession.size;
  }

  /**
   * The session's terminal, spawning it on first use.
   *
   * The check-then-spawn is SINGLE-FLIGHTED: the client legitimately opens
   * twice in a row (an open before the shell inventory lands, another once it
   * has), and an awaited spawn leaves a window where two opens both see "no
   * session" — two ptys for one tab, both broadcasting, their escape streams
   * interleaving into on-screen garbage (the 「首行 >>>> 乱码」 report). The
   * first spawn's promise is parked, and every concurrent open awaits the same
   * one.
   *
   * An EXITED terminal is NOT replaced here: its scrollback is the last thing
   * the reader needs to see (why did it die?), and the panel's explicit new-
   * terminal gesture (`term_kill` + `term_open`) is what starts a fresh one.
   * @param sessionId - the owning session.
   * @param onOutput - notified per released output chunk.
   * @param onExit - notified once the process is gone.
   * @throws whatever the spawner throws (missing addon, missing shell) — the
   *   caller reports it as an `unavailable` answer and retries on next open.
   */
  async ensure(
    sessionId: string,
    opts: { file: string; args: readonly string[]; cwd: string; cols: number; rows: number },
    onOutput: (chunk: string) => void,
    onExit: (exitCode: number | undefined) => void,
  ): Promise<TermSession> {
    const existing = this.bySession.get(sessionId);
    if (existing !== undefined) return existing;
    const inFlight = this.spawning.get(sessionId);
    if (inFlight !== undefined) return inFlight;
    const promise = (async () => {
      const handle = await this.spawnPty({ file: opts.file, args: opts.args, cwd: opts.cwd, cols: opts.cols, rows: opts.rows });
      // The spawn lost a race with a dispose/switch: the pty it produced is
      // nobody's. Kill it here, immediately, and refuse to register it — this
      // is the latch that keeps the registry the only place a terminal can
      // outlive its session's interest in it.
      if (this.cancelled.has(sessionId)) {
        killPtyTree(handle);
        throw new Error('terminal spawn cancelled');
      }
      const created = new TermSession(handle, onOutput, onExit);
      this.bySession.set(sessionId, created);
      return created;
    })();
    this.spawning.set(sessionId, promise);
    try {
      return await promise;
    } finally {
      this.spawning.delete(sessionId);
      this.cancelled.delete(sessionId);
    }
  }

  /**
   * The session's terminal, when one exists.
   * @param sessionId - the asking session.
   */
  get(sessionId: string): TermSession | undefined {
    return this.bySession.get(sessionId);
  }

  /**
   * Terminate and forget one session's terminal. Also arms the spawn-cancel
   * latch: if a spawn for this session is in flight, its result is killed on
   * arrival instead of registering.
   * @param sessionId - the session that owned it.
   */
  dispose(sessionId: string): void {
    const term = this.bySession.get(sessionId);
    this.bySession.delete(sessionId);
    if (this.spawning.has(sessionId)) this.cancelled.add(sessionId);
    if (term !== undefined) term.kill();
  }

  /**
   * Terminate and forget EVERY session's terminal (process teardown). Any
   * spawn still in flight is cancelled the same way, so the count ends at
   * zero — no shell survives the host that owned it.
   */
  disposeAll(): void {
    // dispose() removes from the map, so iterate a snapshot (Array.from — the
    // spread spelling here reads as needless to the linter, the copy is not).
    for (const sessionId of Array.from(this.bySession.keys())) this.dispose(sessionId);
    // Sessions with a spawn in flight but no registered terminal: arm the
    // latch for those too, so a late spawn cannot re-register after teardown.
    for (const sessionId of this.spawning.keys()) this.cancelled.add(sessionId);
  }

  /**
   * Keep one session's terminal and terminate every other one.
   *
   * Called after every inbound frame rather than at the points that can change
   * the live session (a switch, a resume, a workspace move): which frame moved
   * it is exactly the knowledge that rots — same rule as the old shell registry.
   * @param sessionId - the session that is now current.
   */
  retainOnly(sessionId: string): void {
    // The map is mutated by `dispose` while iterating, so the keys are taken
    // one at a time off a copy of the ITERATOR (`Map` iteration is live).
    const ids = this.bySession.keys();
    for (let next = ids.next(); next.done !== true; next = ids.next()) {
      if (next.value !== sessionId) this.dispose(next.value);
    }
  }
}
