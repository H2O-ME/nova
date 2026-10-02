/**
 * The 变更 tab's git lens: status / diff / log, the three index operations, and
 * the one cache that keeps a 200-file working tree from being re-scanned on
 * every glance.
 *
 * **Why a cache at all.** `gitStatus` runs three processes (`rev-parse`,
 * `symbolic-ref`, `status --porcelain -z --untracked-files=all`), and the last
 * one walks the whole tree — on a big repository that is tens of milliseconds
 * of disk on a good day and much worse on a cold one. The panel asks for status
 * when the tab opens, when the file tree mounts, after every stage/unstage/
 * commit and whenever the reader hits refresh, and a `git_diff` used to run a
 * SECOND full status just to learn whether the file was untracked. Caching the
 * reading for a couple of seconds collapses all of that into one scan, and the
 * mutations invalidate it outright so an answer can never describe an index that
 * has already moved.
 *
 * **Why a TTL and not a subscription.** The panel is a reader, not a watcher:
 * `git status` has no change feed without a filesystem watcher, and the honest
 * cheap approximation is "the reading is at most N seconds old". A mutation is
 * the one event we DO know about, so it evicts.
 *
 * Every mutating answer is a fresh `git_status`: the panel re-renders from the
 * host's reading of the index, never from its own optimistic guess. `git is not
 * installed` and `this is not a repository` are both ANSWERS (`repo: false`),
 * not errors — the tab says which one it is.
 */
import { errMessage, gitCommit, gitDiff, gitLog, gitStage, gitStatus, gitUnstage, gitUntrackedDiff } from '@nova-agent/core';
import type { GitStatus } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/**
 * How long one status reading may serve readers.
 *
 * Chosen against the panel's own gestures rather than a stopwatch: opening the
 * tab, mounting the file tree and hitting refresh happen within a second or two
 * of each other, and all three want the same answer. Longer would make a stage
 * performed in another terminal window invisible for too long.
 */
export const GIT_STATUS_TTL_MS = 2000;

/**
 * One workspace's status, with its age.
 *
 * Keyed by rootDir: a workspace switch is a different repository (or none), and
 * carrying a reading across it would decorate the new tree with the old one's
 * changes — the same mistake the client used to make by not resetting its slice.
 */
export class GitStatusCache {
  private readonly byRoot = new Map<string, { status: GitStatus; at: number }>();
  private readonly inFlight = new Map<string, Promise<GitStatus>>();

  /**
   * The workspace's status, from the cache when it is fresh.
   * @param rootDir - the workspace root git runs in.
   * @param fresh - skip the cache (a mutation's answer must be a new reading).
   */
  async read(rootDir: string, fresh = false): Promise<GitStatus> {
    const now = Date.now();
    const hit = this.byRoot.get(rootDir);
    if (!fresh && hit !== undefined && now - hit.at < GIT_STATUS_TTL_MS) return hit.status;
    // One scan per workspace even when three readers ask at once: the second
    // caller awaits the first's promise instead of starting a fourth process.
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

  /**
   * Drop one workspace's reading (a mutation just changed the index).
   * @param rootDir - the workspace whose reading is stale.
   */
  invalidate(rootDir: string): void {
    this.byRoot.delete(rootDir);
  }
}

/** What these frames need from the controller. */
export interface GitFrameHost {
  /** The live tool root: git runs here and paths resolve against it. */
  rootDir: string;
  /** The shared status reading (one per process: every reader sees one answer). */
  cache: GitStatusCache;
}

/** The git frames this module answers. */
export type GitFrame = Extract<
  ClientFrame,
  { type: 'git_status' | 'git_diff' | 'git_stage' | 'git_unstage' | 'git_commit' | 'git_log' }
>;

/**
 * Route one git frame.
 * @param client - the socket the frame arrived on (replies go here).
 * @param frame - the validated frame.
 * @param host - the controller's own collaborators.
 * @returns nothing; every answer is a frame on this client.
 */
export async function handleGitFrame(client: WsConnection, frame: GitFrame, host: GitFrameHost): Promise<void> {
  switch (frame.type) {
    case 'git_status':
      client.send(serialize({ type: 'git_status', ...(await host.cache.read(host.rootDir)) }));
      return;
    case 'git_diff': {
      const diff = await gitDiff(host.rootDir, frame.path, frame.staged);
      // An untracked file has no diff at all: the panel renders the file's own
      // text as an all-new diff, so the flag is part of the answer. The status
      // comes from the cache — this used to run a second full scan per click.
      const status = await host.cache.read(host.rootDir);
      const entry = status.entries.find((candidate) => candidate.path === diff.path);
      const untracked = entry !== undefined && entry.index === '?' && entry.worktree === '?';
      // The fallback reads the file and answers "entirely new" as content; an
      // empty text (binary, oversized, empty file) keeps the panel's note.
      const answer = untracked ? await gitUntrackedDiff(host.rootDir, frame.path) : diff;
      client.send(serialize({ type: 'git_diff', ...answer, untracked }));
      return;
    }
    case 'git_stage':
      await gitStage(host.rootDir, frame.paths);
      host.cache.invalidate(host.rootDir);
      client.send(serialize({ type: 'git_status', ...(await host.cache.read(host.rootDir, true)) }));
      return;
    case 'git_unstage':
      await gitUnstage(host.rootDir, frame.paths);
      host.cache.invalidate(host.rootDir);
      client.send(serialize({ type: 'git_status', ...(await host.cache.read(host.rootDir, true)) }));
      return;
    case 'git_commit': {
      // The commit's own line rides the refreshed status: the panel renders it
      // beside the list it just emptied, so "it worked" is the index's state
      // plus one sentence, not a toast that can outlive its evidence.
      const message = await commitLine(host.rootDir, frame.message);
      host.cache.invalidate(host.rootDir);
      client.send(serialize({ type: 'git_status', ...(await host.cache.read(host.rootDir, true)), message }));
      return;
    }
    case 'git_log':
      client.send(serialize({ type: 'git_log', entries: await gitLog(host.rootDir, frame.limit ?? 30) }));
      return;
  }
}

/** Commit, and phrase the one line the panel shows about it. */
async function commitLine(rootDir: string, message: string): Promise<string> {
  try {
    const { short, summary } = await gitCommit(rootDir, message);
    return `已提交 ${short}：${summary}`;
  } catch (err) {
    return `提交失败：${errMessage(err)}`;
  }
}
