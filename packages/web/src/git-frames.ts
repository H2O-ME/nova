/**
 * The file tree's git decorations: status, and the one cache that keeps a
 * 200-file working tree from being re-scanned on every glance.
 *
 * **Why a cache at all.** `gitStatus` runs three processes (`rev-parse`,
 * `symbolic-ref`, `status --porcelain -z --untracked-files=all`), and the last
 * one walks the whole tree — on a big repository that is tens of milliseconds
 * of disk on a good day and much worse on a cold one. The tree asks when it
 * mounts and whenever the reader hits refresh; caching the reading for a
 * couple of seconds collapses those into one scan.
 *
 * **Why a TTL and not a subscription.** The panel is a reader, not a watcher:
 * `git status` has no change feed without a filesystem watcher, and the honest
 * cheap approximation is "the reading is at most N seconds old".
 *
 * `git is not installed` and `this is not a repository` are both ANSWERS
 * (`repo: false`), not errors.
 */
import { gitStatus } from '@nova-agent/core';
import type { GitStatus } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './connection.js';

/**
 * How long one status reading may serve readers.
 *
 * Chosen against the panel's own gestures rather than a stopwatch: mounting the
 * file tree and hitting refresh happen within a second or two of each other,
 * and both want the same answer.
 */
export const GIT_STATUS_TTL_MS = 2000;

/**
 * One workspace's status, with its age.
 *
 * Keyed by rootDir: a workspace switch is a different repository (or none), and
 * carrying a reading across it would decorate the new tree with the old one's
 * changes.
 */
export class GitStatusCache {
  private readonly byRoot = new Map<string, { status: GitStatus; at: number }>();
  private readonly inFlight = new Map<string, Promise<GitStatus>>();

  /**
   * The workspace's status, from the cache when it is fresh.
   * @param rootDir - the workspace root git runs in.
   * @param fresh - skip the cache (an explicit refresh must be a new reading).
   */
  async read(rootDir: string, fresh = false): Promise<GitStatus> {
    const now = Date.now();
    const hit = this.byRoot.get(rootDir);
    if (!fresh && hit !== undefined && now - hit.at < GIT_STATUS_TTL_MS) return hit.status;
    // One scan per workspace even when three readers ask at once: the second
    // caller awaits the first's promise instead of starting another process.
    const pending = this.inFlight.get(rootDir);
    if (!fresh && pending !== undefined) return pending;
    const started = gitStatus(rootDir)
      .then((status) => {
        this.byRoot.set(rootDir, { status, at: Date.now() });
        return status;
      })
      .finally(() => { this.inFlight.delete(rootDir); });
    this.inFlight.set(rootDir, started);
    return started;
  }
}

/** What these frames need from the controller. */
export interface GitFrameHost {
  /** The live tool root: git runs here and paths resolve against it. */
  rootDir: string;
  /** The shared status reading (one per process: every reader sees one answer). */
  cache: GitStatusCache;
}

/** The one git frame this module answers. */
export type GitFrame = Extract<ClientFrame, { type: 'git_status' }>;

/**
 * Route one git frame.
 * @param client - the socket the frame arrived on (replies go here).
 * @param _frame - the validated frame (only `git_status` remains).
 * @param host - the controller's own collaborators.
 * @returns nothing; the answer is a frame on this client.
 */
export async function handleGitFrame(client: WsConnection, _frame: GitFrame, host: GitFrameHost): Promise<void> {
  client.send(serialize({ type: 'git_status', ...(await host.cache.read(host.rootDir)) }));
}
