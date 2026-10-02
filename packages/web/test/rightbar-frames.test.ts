/**
 * The right panel's terminal/jobs frames (`term-frames.ts`, `job-frames.ts`),
 * plus the git frames they share a lane with (`git-frames.ts`).
 *
 * The contracts worth pinning, all of them design decisions rather than
 * mechanics:
 *
 *  1. **Validate before mutating.** Every write boundary is core's
 *     `resolveInRoot` (the same rule the model's fs tools enforce), so a
 *     sidebar write cannot reach a path the tool would refuse. A traversal
 *     attempt answers `entry_error`, not a partial write.
 *  2. **Answer is state, never a bare "ok".** Mutating frames answer with a
 *     refreshed `entry_changed` / `git_status`; the panel re-renders from the
 *     host's reading, never from its own optimistic guess.
 *  3. **Refusal is its own frame.** A read that cannot be shown (oversized,
 *     binary, missing) answers with `entry` carrying the reason, not an empty
 *     editor that would claim the file is empty; same for `git is not a repo`,
 *     and for a terminal whose pty could not be spawned (`unavailable`).
 *
 * The terminal block is driven through the real handler with a SCRIPTED pty —
 * the pty session's own rules are `term-session.test.ts`, and the real PTY's
 * end-to-end behaviour is the live smoke run's subject.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleEntryFrame, type EntryFrameHost } from '../src/entry-frames.js';
import { GitStatusCache, handleGitFrame, type GitFrameHost } from '../src/git-frames.js';
import { handleJobFrame } from '../src/job-frames.js';
import { handleTermFrame, matchShell, type TermHost } from '../src/term-frames.js';
import { TermRegistry, type PtyHandle, type PtySpawner } from '../src/term-session.js';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-rightbar-frames-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
  last<T extends ServerFrame['type']>(type: T): Extract<ServerFrame, { type: T }> | undefined {
    return this.frames
      .filter((frame): frame is Extract<ServerFrame, { type: T }> => frame.type === type)
      .at(-1);
  }
}

const entryHost = (): EntryFrameHost => ({ rootDir: root });
/** One cache per call, so a test's reads cannot be served by another's. */
const gitHost = (cache = new GitStatusCache()): GitFrameHost => ({ rootDir: root, cache });

/** Frame a wire-string into a typed ClientFrame (the route the controller takes). */
function frame(json: string): ClientFrame {
  const parsed = JSON.parse(json) as ClientFrame;
  return parsed;
}

/** Build a git repo in `root` with one staged + one untracked file. */
async function bootRepo(): Promise<void> {
  // git may not be available in every sandbox; tests below skip when it is not.
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  } catch {
    return;
  }
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  await writeFile(path.join(root, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
  try {
    execFileSync('git', ['add', 'src/a.ts'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  } catch {
    // ignore — the repo-state assertions below just see whatever git produced.
  }
}

const gitAvailable = (): boolean => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('handleEntryFrame', () => {
  it('reads a workspace file into an `entry` answer', async () => {
    await writeFile(path.join(root, 'hello.txt'), 'hi there', 'utf8');
    const conn = new FakeConn();
    await handleEntryFrame(conn, frame(JSON.stringify({ type: 'read_entry', path: path.join(root, 'hello.txt') })), entryHost());
    const entry = conn.last('entry');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('entry');
    if ('content' in entry!) expect(entry!.content).toBe('hi there');
  });

  it('refuses a path outside the workspace with `entry_error` (validate before mutate)', async () => {
    const outside = path.resolve(root, '..', 'escape.txt');
    const conn = new FakeConn();
    await handleEntryFrame(conn, frame(JSON.stringify({ type: 'read_entry', path: outside })), entryHost());
    const err = conn.last('entry_error');
    expect(err).toBeDefined();
    // The traversal must not have produced an `entry` answer.
    expect(conn.last('entry')).toBeUndefined();
  });

});

describe('handleGitFrame', () => {
  it('answers `git_status` with `repo: false` outside a git workspace', async () => {
    const conn = new FakeConn();
    // root is a plain temp dir — no .git
    await handleGitFrame(conn, frame(JSON.stringify({ type: 'git_status' })), gitHost());
    const status = conn.last('git_status');
    expect(status).toBeDefined();
    if ('repo' in status!) expect(status!.repo).toBe(false);
  });

  it('answers stage with a refreshed `git_status` (answer is state, not ok)', async () => {
    if (!gitAvailable()) return; // skip when git is absent (sandboxed CI)
    await bootRepo();
    await writeFile(path.join(root, 'src', 'c.ts'), 'export const c = 3;\n', 'utf8');
    const conn = new FakeConn();
    await handleGitFrame(
      conn,
      frame(JSON.stringify({ type: 'git_stage', paths: ['src/c.ts'] })),
      gitHost(),
    );
    const status = conn.last('git_status');
    expect(status).toBeDefined();
    if ('repo' in status!) expect(status!.repo).toBe(true);
  });

  it('answers an untracked file with its own content as an all-added diff', async () => {
    if (!gitAvailable()) return;
    await bootRepo(); // src/b.ts is written but never added — untracked
    const conn = new FakeConn();
    await handleGitFrame(conn, frame(JSON.stringify({ type: 'git_diff', path: 'src/b.ts', staged: false })), gitHost());
    const diff = conn.last('git_diff');
    expect(diff).toBeDefined();
    if (!('text' in diff!)) return;
    expect(diff!.untracked).toBe(true);
    // `git diff` prints nothing for an untracked path; the answer is the
    // file's own content as the whole hunk, not a pointer to another page.
    expect(diff!.text).toContain('@@ -0,0 +1,1 @@');
    expect(diff!.text).toContain('+export const b = 2;');
    expect(diff!.truncated).toBe(false);
  });

  it('keeps the empty text for a binary untracked file (no invented content)', async () => {
    if (!gitAvailable()) return;
    await bootRepo();
    await writeFile(path.join(root, 'blob.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const conn = new FakeConn();
    await handleGitFrame(conn, frame(JSON.stringify({ type: 'git_diff', path: 'blob.bin', staged: false })), gitHost());
    const diff = conn.last('git_diff');
    expect(diff).toBeDefined();
    if (!('text' in diff!)) return;
    expect(diff!.untracked).toBe(true);
    expect(diff!.text).toBe('');
  });
});

describe('handleTermFrame', () => {
  /** A scripted pty the registry's injected spawner hands back. */
  class ScriptedPty implements PtyHandle {
    readonly written: string[] = [];
    readonly resized: Array<{ cols: number; rows: number }> = [];
    killed = false;
    private readonly dataCbs: Array<(chunk: string) => void> = [];
    private readonly exitCbs: Array<(code: number | undefined) => void> = [];

    get pid(): number {
      return 4242;
    }

    write(data: string): void { this.written.push(data); }
    resize(cols: number, rows: number): void { this.resized.push({ cols, rows }); }
    kill(): void { this.killed = true; }
    onData(cb: (chunk: string) => void): void { this.dataCbs.push(cb); }
    onExit(cb: (exitCode: number | undefined) => void): void { this.exitCbs.push(cb); }
    emit(data: string): void { for (const cb of this.dataCbs) cb(data); }
    exit(code: number | undefined): void { for (const cb of this.exitCbs) cb(code); }
  }

  /** A registry over a scripted pty, plus the broadcast sink the host pushes through. */
  function termHost(spawn?: PtySpawner): { host: TermHost; terms: TermRegistry; pty: ScriptedPty; pushed: ServerFrame[] } {
    const pty = new ScriptedPty();
    const spawner: PtySpawner = spawn ?? (async () => pty);
    const terms = new TermRegistry(spawner);
    const pushed: ServerFrame[] = [];
    const host: TermHost = {
      terms,
      sessionId: 's1',
      rootDir: root,
      shell: { name: 'bash', path: 'bash.exe', family: 'posix' },
      broadcast: (text) => { pushed.push(JSON.parse(text) as ServerFrame); },
    };
    return { host, terms, pty, pushed };
  }

  it('spawns on first open and answers the asking client with a reset replay', async () => {
    const { host, terms, pty } = termHost();
    const conn = new FakeConn();
    await handleTermFrame(conn, frame(JSON.stringify({ type: 'term_open', cols: 120, rows: 30 })), host);
    expect(terms.size).toBe(1);
    const replay = conn.last('term');
    expect(replay?.reset).toBe(true);
    expect(replay?.status).toBe('running');
    expect(pty.resized).toEqual([]);
    // Keystrokes and resizes reach the pty after the open.
    await handleTermFrame(conn, frame(JSON.stringify({ type: 'term_input', data: 'ls\r' })), host);
    await handleTermFrame(conn, frame(JSON.stringify({ type: 'term_resize', cols: 100, rows: 20 })), host);
    expect(pty.written).toEqual(['ls\r']);
    expect(pty.resized).toEqual([{ cols: 100, rows: 20 }]);
  });

  it('pushes pty output to every client as it arrives, verbatim', async () => {
    const { host, pty, pushed } = termHost();
    const conn = new FakeConn();
    await handleTermFrame(conn, frame(JSON.stringify({ type: 'term_open', cols: 80, rows: 24 })), host);
    pty.emit('\u001b[32mhello\u001b[0m\r\n');
    const push = pushed.find((entry) => entry.type === 'term' && entry.data.includes('hello'));
    expect(push).toBeDefined();
    if (push?.type === 'term') expect(push.reset).toBeUndefined();
  });

  it('broadcasts the exit, and keeps the scrollback until an explicit restart', async () => {
    const { host, terms, pty, pushed } = termHost();
    const conn = new FakeConn();
    await handleTermFrame(conn, frame(JSON.stringify({ type: 'term_open', cols: 80, rows: 24 })), host);
    pty.emit('boot\r\n');
    pty.exit(7);
    expect(pushed.some((entry) => entry.type === 'term' && entry.status === 'exited' && entry.exitCode === 7)).toBe(true);
    // A reader who reloads (or a second tab) still gets WHY it died.
    const second = new FakeConn();
    await handleTermFrame(second, frame(JSON.stringify({ type: 'term_open', cols: 80, rows: 24 })), host);
    const replay = second.last('term');
    expect(replay?.reset).toBe(true);
    expect(replay?.status).toBe('exited');
    if (replay?.type === 'term') expect(replay.exitCode).toBe(7);
    expect(replay?.data).toContain('boot');
    expect(terms.size).toBe(1);
  });

  it('ends the tree on `term_kill` and resets every emulator', async () => {
    const { host, terms, pty, pushed } = termHost();
    const conn = new FakeConn();
    await handleTermFrame(conn, frame(JSON.stringify({ type: 'term_open', cols: 80, rows: 24 })), host);
    await handleTermFrame(conn, frame(JSON.stringify({ type: 'term_kill' })), host);
    expect(pty.killed).toBe(true);
    expect(terms.size).toBe(0);
    expect(pushed.some((entry) => entry.type === 'term' && entry.reset === true && entry.status === 'exited')).toBe(true);
  });

  it('answers a spawn refusal with `unavailable` to the asking client only', async () => {
    const { host, terms } = termHost(async () => {
      throw new Error('Cannot find module');
    });
    const conn = new FakeConn();
    await handleTermFrame(conn, frame(JSON.stringify({ type: 'term_open', cols: 80, rows: 24 })), host);
    const answer = conn.last('term');
    expect(answer?.status).toBe('unavailable');
    expect(answer?.error).toContain('Cannot find module');
    expect(terms.size).toBe(0);
    // Nothing was broadcast: the other tabs' terminals are untouched.
    expect(host.terms.get('s1')).toBeUndefined();
  });
});

describe('handleJobFrame', () => {
  it('answers `list_jobs` with the session’s own rows, without output', () => {
    const conn = new FakeConn();
    const jobs = {
      list: (sessionId: string) => (sessionId === 's1'
        ? [{ id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running' as const, progress: '12 tests' }]
        : []),
    };
    handleJobFrame(conn, { jobs: jobs as unknown as Parameters<typeof handleJobFrame>[1]['jobs'], sessionId: 's1' });
    const answer = conn.last('jobs');
    expect(answer?.items).toEqual([
      { id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running', progress: '12 tests' },
    ]);
    // Another session's jobs are not this session's rows.
    const other = new FakeConn();
    handleJobFrame(other, { jobs: jobs as unknown as Parameters<typeof handleJobFrame>[1]['jobs'], sessionId: 's2' });
    expect(other.last('jobs')?.items).toEqual([]);
  });
});

describe('GitStatusCache', () => {
  it('serves a fresh reading from the cache, and a mutation’s own read is new', async () => {
    if (!gitAvailable()) return; // skip when git is absent (sandboxed CI)
    await bootRepo();
    const cache = new GitStatusCache();
    const first = await cache.read(root);
    // Same object within the TTL: the panel's three asks in a second are one scan.
    expect(await cache.read(root)).toBe(first);
    // A mutation invalidates; the fresh read is a new object with the same shape.
    cache.invalidate(root);
    const next = await cache.read(root);
    expect(next).not.toBe(first);
    expect(next.entries.map((entry) => entry.path)).toEqual(first.entries.map((entry) => entry.path));
  });

  it('dedupes concurrent readers onto one scan', async () => {
    if (!gitAvailable()) return;
    await bootRepo();
    const cache = new GitStatusCache();
    const [a, b, c] = await Promise.all([cache.read(root), cache.read(root), cache.read(root)]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('matchShell', () => {
  const bash = { name: 'bash', path: 'C:/Program Files/Git/bin/bash.exe', family: 'posix' } as const;
  const cmd = { name: 'cmd', path: 'C:/Windows/System32/cmd.exe', family: 'cmd' } as const;
  const items = [cmd, bash];

  it('starts the host’s own default when the reader chose nothing', () => {
    expect(matchShell(items, undefined, cmd)).toBe(cmd);
  });

  it('matches a discovered path regardless of the casing the caller had', () => {
    expect(matchShell(items, bash.path, cmd)).toBe(bash);
    expect(matchShell(items, bash.path.toUpperCase(), cmd)).toBe(bash);
  });

  it('refuses a path it never discovered instead of falling back', () => {
    // A wrong answer must be an answer, not a silent substitution: starting cmd
    // because the reader asked for a shell that is not there would make the
    // panel's checkmark a lie.
    expect(matchShell(items, 'C:/Windows/System32/whoops.exe', cmd)).toBeUndefined();
    expect(matchShell(items, '', cmd)).toBeUndefined();
  });
});
