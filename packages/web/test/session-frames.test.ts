/**
 * The `git_clone` session-target frame (`session-frames.ts`).
 *
 * A clone is a `set_workspace` whose directory does not exist yet: the frame's
 * whole job is to end on the same re-stated baseline (`ready`), so the panel
 * lands on the new repository without a second gesture. These tests pin the
 * three outcomes a reader can hit — the clone lands and the workspace moves,
 * a drive root refuses with a named reason, and a failed clone moves NOTHING.
 *
 * THE FIXTURES ARE ASYNC AND BUDGETED, for the reasons measured in
 * `rightbar-frames.test.ts`'s header (git spawns 291-353ms idle but
 * 1.7-3.2s while the lane is busy, because every spawn is a new process image
 * on a four-core box). Two of the three cases below run real `git`; they carry
 * an explicit budget so a spawn cannot be mistaken for a hang, and their
 * fixture calls are awaited rather than blocking the worker's event loop. The
 * drive-root case deliberately keeps the DEFAULT budget: it refuses before
 * touching git, so there is no environment cost for a budget to excuse — which
 * is exactly what makes the other two honest. No assertion changed.
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSessionFrame, type SessionFrameHost } from '../src/session-frames.js';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';

const runGit = promisify(execFile);

/** Wall clock one fixture git invocation may take (see rightbar-frames.test.ts). */
const GIT_FIXTURE_TIMEOUT_MS = 30_000;
/** Budget for the cases whose own body runs `git` (see the header above). */
const GIT_TEST_TIMEOUT_MS = 60_000;

/**
 * Whether `git` can run at all, probed ONCE for the file.
 *
 * `it.skipIf` needs the answer at COLLECTION time, so this cannot be async —
 * but it can be asked once. It used to run once per case, i.e. two extra
 * process creations paid before a single test started.
 */
let probedGit: boolean | undefined;
const gitAvailable = (): boolean => {
  probedGit ??= (() => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore', timeout: GIT_FIXTURE_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  })();
  return probedGit;
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-session-frames-'));
});
afterEach(async () => {
  // `maxRetries` is Node's own Windows remedy for a handle that has not been
  // released yet (`EBUSY rmdir` is what a bare `rm` produced).
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
}

function hostFor(currentRoot: string): SessionFrameHost & {
  setWorkspace: ReturnType<typeof vi.fn>;
  broadcastReady: ReturnType<typeof vi.fn>;
  sendSessions: ReturnType<typeof vi.fn>;
} {
  return {
    currentSessionFile: () => undefined,
    abandonCurrentSession: async () => {},
    setWorkspace: vi.fn(async () => {}),
    broadcastReady: vi.fn(() => {}),
    sendSessions: vi.fn(async () => {}),
    currentRootDir: () => currentRoot,
  };
}

function frame(json: string): ClientFrame {
  return JSON.parse(json) as ClientFrame;
}

describe('handleSessionFrame / git_clone', () => {
  it.skipIf(!gitAvailable())('clones into the workspace’s parent and opens the clone', async () => {
    // The source is a real local repository, parked in its own subdirectory:
    // the clone lands in the workspace's PARENT (`root`), so a source sitting
    // there would collide with the destination git is about to create.
    const sourceRoot = path.join(root, 'source');
    const source = path.join(sourceRoot, 'src-repo');
    await mkdir(source, { recursive: true });
    await runGit('git', ['init', '-q', source], { timeout: GIT_FIXTURE_TIMEOUT_MS });
    await runGit('git', ['config', 'user.email', 't@t'], { cwd: source, timeout: GIT_FIXTURE_TIMEOUT_MS });
    await runGit('git', ['config', 'user.name', 't'], { cwd: source, timeout: GIT_FIXTURE_TIMEOUT_MS });
    await runGit('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: source, timeout: GIT_FIXTURE_TIMEOUT_MS });

    const workspace = path.join(root, 'ws');
    await mkdir(workspace);
    const host = hostFor(workspace);
    const conn = new FakeConn();

    const handled = await handleSessionFrame(conn, frame(JSON.stringify({ type: 'git_clone', url: source })), host);
    expect(handled).toBe(true);

    // The clone is a sibling of the open workspace, and the workspace MOVED.
    const cloned = path.join(root, 'src-repo');
    expect(existsSync(path.join(cloned, '.git'))).toBe(true);
    expect(host.setWorkspace).toHaveBeenCalledTimes(1);
    expect(vi.mocked(host.setWorkspace).mock.calls[0]?.[0]).toBe(cloned);
    expect(host.sendSessions).toHaveBeenCalledTimes(1);
    expect(host.broadcastReady).toHaveBeenCalledTimes(1);
  }, GIT_TEST_TIMEOUT_MS);

  it.skipIf(!gitAvailable())('refuses a drive root by name, before touching git', async () => {
    const driveRoot = path.parse(root).root;
    const host = hostFor(driveRoot);
    const conn = new FakeConn();

    await expect(
      handleSessionFrame(conn, frame(JSON.stringify({ type: 'git_clone', url: 'https://example.com/x.git' })), host),
    ).rejects.toThrow('盘符根目录');
    expect(host.setWorkspace).not.toHaveBeenCalled();
    expect(host.broadcastReady).not.toHaveBeenCalled();
  });

  it.skipIf(!gitAvailable())('moves nothing when the clone itself fails', async () => {
    const workspace = path.join(root, 'ws');
    await mkdir(workspace);
    const host = hostFor(workspace);
    const conn = new FakeConn();

    // A source that does not exist (and never collides with the destination
    // git creates — that collision makes an empty-repo "success").
    await expect(
      handleSessionFrame(conn, frame(JSON.stringify({ type: 'git_clone', url: path.join(root, 'source', 'not-a-repo') })), host),
    ).rejects.toThrow();
    // Validate-before-mutate: a failed clone leaves the workspace where it was.
    expect(host.setWorkspace).not.toHaveBeenCalled();
    expect(host.broadcastReady).not.toHaveBeenCalled();
  }, GIT_TEST_TIMEOUT_MS);
});
