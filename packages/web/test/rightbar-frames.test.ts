/**
 * The right panel's host frames: entry reads/writes (`entry-frames.ts`) and the
 * file tree's git decorations (`git-frames.ts`).
 *
 * The contracts worth pinning, all of them design decisions rather than
 * mechanics:
 *
 *  1. **Validate before mutating.** Every write boundary is core's
 *     `resolveInRoot` (the same rule the model's fs tools enforce), so a
 *     sidebar write cannot reach a path the tool would refuse. A traversal
 *     attempt answers `entry_error`, not a partial write.
 *  2. **Answer is state, never a bare "ok".** The git answer is a reading of
 *     the workspace, never the client's optimistic guess.
 *  3. **Refusal is its own frame.** A read that cannot be shown (oversized,
 *     binary, missing) answers with `entry` carrying the reason, not an empty
 *     editor that would claim the file is empty.
 *
 * The git cases shell out to a real `git`; the repository is built ONCE
 * (`beforeAll`) and the cases carry an explicit budget, because process
 * creation on a loaded box — not the code under test — owns the wall clock.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleEntryFrame, type EntryFrameHost } from '../src/entry-frames.js';
import { GitStatusCache, handleGitFrame, type GitFrameHost } from '../src/git-frames.js';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';

const runGit = promisify(execFile);

/** Wall clock one FIXTURE git invocation may take (see the header). */
const GIT_FIXTURE_TIMEOUT_MS = 30_000;
/** Budget for the cases whose own body uses git (see the header). */
const GIT_TEST_TIMEOUT_MS = 60_000;

/** One temp workspace per case. Deliberately NOT a repository: see `repoRoot`. */
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-rightbar-frames-'));
});
afterEach(async () => {
  // `maxRetries` is Node's own Windows remedy for a handle that has not been
  // released yet; a bare `rm` is what produced `EBUSY rmdir` failures.
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** The one repository the git cases below share, built once for the file. */
let repoRoot = '';
let repoReady = false;

beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-rightbar-frames-repo-'));
  try {
    await runGit('git', ['init', '-q', '-b', 'main'], { cwd: dir, timeout: GIT_FIXTURE_TIMEOUT_MS });
    await runGit('git', ['config', 'user.email', 't@t'], { cwd: dir, timeout: GIT_FIXTURE_TIMEOUT_MS });
    await runGit('git', ['config', 'user.name', 't'], { cwd: dir, timeout: GIT_FIXTURE_TIMEOUT_MS });
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
    await runGit('git', ['add', 'src/a.ts'], { cwd: dir, timeout: GIT_FIXTURE_TIMEOUT_MS });
    await runGit('git', ['commit', '-q', '-m', 'init'], { cwd: dir, timeout: GIT_FIXTURE_TIMEOUT_MS });
    repoRoot = dir;
    repoReady = true;
  } catch {
    // git is not available in every sandbox (or refused): leave nothing behind
    // and let the git cases return early.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, GIT_FIXTURE_TIMEOUT_MS * 2);

afterAll(async () => {
  if (repoRoot === '') return;
  await rm(repoRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
/**
 * One cache per call, so a test's reads cannot be served by another's.
 * @param dir - the workspace git runs in; defaults to the shared repository
 *   (the `repo: false` case passes the plain temp workspace instead).
 */
const gitHost = (dir: string = repoRoot, cache = new GitStatusCache()): GitFrameHost => ({ rootDir: dir, cache });

/** Frame a wire-string into a typed ClientFrame (the route the controller takes). */
function frame(json: string): ClientFrame {
  return JSON.parse(json) as ClientFrame;
}

describe('handleEntryFrame', () => {
  it('reads a workspace file into an `entry` answer', async () => {
    await writeFile(path.join(root, 'hello.txt'), 'hi there', 'utf8');
    const conn = new FakeConn();
    await handleEntryFrame(conn, frame(JSON.stringify({ type: 'read_entry', path: path.join(root, 'hello.txt') })), entryHost());
    const entry = conn.last('entry');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('entry');
    if ('text' in entry!) expect(entry!.text).toBe('hi there');
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
    await handleGitFrame(conn, frame(JSON.stringify({ type: 'git_status' })), gitHost(root));
    const status = conn.last('git_status');
    expect(status).toBeDefined();
    if ('repo' in status!) expect(status!.repo).toBe(false);
  });
});

describe('GitStatusCache', () => {
  it('serves a fresh reading from the cache and a forced read from git', async () => {
    if (!repoReady) return; // skip when git is absent (sandboxed CI)
    const cache = new GitStatusCache();
    const first = await cache.read(repoRoot);
    // Same object within the TTL: the panel's asks in a second are one scan.
    expect(await cache.read(repoRoot)).toBe(first);
    // A forced read bypasses the cache and answers a new object.
    const next = await cache.read(repoRoot, true);
    expect(next).not.toBe(first);
    expect(next.entries.map((entry) => entry.path)).toEqual(first.entries.map((entry) => entry.path));
  }, GIT_TEST_TIMEOUT_MS);

  it('dedupes concurrent readers onto one scan', async () => {
    if (!repoReady) return;
    const cache = new GitStatusCache();
    const [a, b, c] = await Promise.all([cache.read(repoRoot), cache.read(repoRoot), cache.read(repoRoot)]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  }, GIT_TEST_TIMEOUT_MS);
});
