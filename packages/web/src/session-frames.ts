/**
 * The two client frames that change WHICH session or workspace is open:
 * `set_workspace` and `delete_session`.
 *
 * Split from `fs-frames.ts` because they answer a different question. The frames
 * there read the filesystem and never change what is open; these two redefine the
 * open session, so they are the only ones that must re-state the surface
 * (`ready`) and the only ones that need the host to say what is currently open.
 * Both obey the same discipline: **validate before changing anything, and answer
 * with state, never a bare "ok".**
 */
import path from 'node:path';
import { deleteSessionLog, gitClone, resolveWorkspaceDir, sessionLogPath } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/** What the session-target frames need from the controller, which owns it all. */
export interface SessionFrameHost {
  /**
   * The log of the session currently open, or undefined when there is none.
   *
   * `delete_session` needs it: deleting the OPEN session's log must also move the
   * session off that file, or the next append recreates it (see the case below).
   * Absolute, already resolved.
   */
  currentSessionFile(): string | undefined;
  /**
   * Move to a fresh session AND stop the one being left behind.
   *
   * Not the same as a plain switch: a switch deliberately leaves the old session
   * running (its work is not lost, and resuming shows the result). Deleting the
   * open session's log takes that work with it, so the old handle must be
   * disposed — otherwise an in-flight run finishing its tool results appends to
   * the path it still holds and `appendFile` RECREATES the log we just deleted.
   */
  abandonCurrentSession(): Promise<void>;
  /**
   * Dispose the live handle on a file that is NOT the open session, if one
   * exists. The missing half of a delete: a session switched away from but
   * still running holds the path, and its next append would recreate the log
   * the operator just removed.
   */
  disposeLiveHandle(file: string): Promise<void>;
  /**
   * Move the workspace, context included. Validation already happened, and the
   * host also re-seeds a still-blank session: its fragment was appended once at
   * creation and is append-only, so it would otherwise keep injecting the old
   * workspace's cwd and AGENTS.md for the session's whole life.
   */
  setWorkspace(dir: string): Promise<void>;
  /** Re-state every client: the workspace is visible only through `ready`. */
  broadcastReady(): void;
  /** Answer one client with the current session list (a read, no broadcast). */
  sendSessions(client: WsConnection): Promise<void>;
  /** The live workspace root (the clone's target is its parent directory). */
  currentRootDir(): string;
}

/**
 * Route one session-target frame.
 * @param client - the socket the frame arrived on (replies go here).
 * @param frame - the validated frame.
 * @param host - the controller's own collaborators.
 * @returns whether the frame belonged to this module.
 */
export async function handleSessionFrame(
  client: WsConnection,
  frame: ClientFrame,
  host: SessionFrameHost,
): Promise<boolean> {
  switch (frame.type) {
    case 'set_workspace': {
      // Validate BEFORE the kernel mutates: `setWorkspace` re-points every tool
      // root at whatever it is handed, so a nonexistent directory or a path
      // inside ~/.nova must be refused here, not discovered later by a failing
      // tool call. The answer is a fresh baseline either way — `ready` states the
      // workspace, so a refusal must not leave the client showing what it asked.
      const dir = await resolveWorkspaceDir(frame.dir);
      await host.setWorkspace(dir);
      await host.sendSessions(client);
      host.broadcastReady();
      return true;
    }
    case 'git_clone': {
      // Clone, then OPEN: the 源代码管理 empty state offers 打开文件夹 and
      // 克隆仓库, and a clone that leaves the workspace where it was is only
      // half of either — the reader would have to find and switch to the new
      // folder by hand. The target is the current workspace's PARENT, so the
      // new repository becomes a sibling of the folder being read (a drive root
      // has no parent to receive it and says so). Everything after the clone is
      // the `set_workspace` path verbatim, validation included: the directory
      // exists (it was just created), but the same gate runs anyway — one rule,
      // not a fast path.
      const current = path.resolve(host.currentRootDir());
      const parent = path.dirname(current);
      if (parent === current) throw new Error('当前工作区是盘符根目录，没有可克隆进的父目录；请先切换到一个普通文件夹');
      const { path: cloned } = await gitClone(parent, frame.url);
      const dir = await resolveWorkspaceDir(cloned);
      await host.setWorkspace(dir);
      await host.sendSessions(client);
      host.broadcastReady();
      return true;
    }
    case 'delete_session': {
      // A refusal (a path outside the sessions root) travels the error frame
      // like every other rejected intent; the list follows either way, so the
      // row disappears because the host says it is gone.
      //
      // Deleting the session that is OPEN is the one case that needs more than
      // an unlink: the handle holds the path and appends to it, and `appendFile`
      // CREATES a missing file. Left alone, the next prompt resurrects a log
      // holding only the events logged after the delete — a session that looks
      // truncated, still listed, and no longer the one the user asked for. So
      // the session moves off the file first: the delete is the last word on it.
      const deletingOpen = targetsOpenSession(frame.file, host.currentSessionFile());
      if (deletingOpen) {
        // Stop the old session BEFORE the unlink, so nothing can append to the
        // path afterwards. A fresh session exists by the time this resolves
        // (the kernel always has one), so no window opens with none.
        await host.abandonCurrentSession();
      } else {
        // A session that was merely SWITCHED AWAY FROM may still be running on
        // a live handle. Without this, its next append — a finishing run, a
        // queued prompt — recreates the deleted log as a truncated shell, and
        // the row the operator removed is back on the list.
        await host.disposeLiveHandle(frame.file);
      }
      const removed = await deleteSessionLog(frame.file);
      // "Already gone" is only worth reporting for a session the user was NOT
      // looking at. For the open one the desired end state is simply that the
      // log is gone, and it is: an error frame there would report a failure the
      // user did not experience.
      if (removed === false && !deletingOpen) {
        client.send(serialize({ type: 'error', message: '会话文件不存在（可能已被删除）' }));
      }
      await host.sendSessions(client);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Whether a delete frame targets the session that is currently open.
 *
 * Compares RESOLVED paths through the same validator `deleteSessionLog` uses, so
 * a differently-spelled path to the same log (`..` segments, `./` prefix) cannot
 * slip past as "some other session" and leave a resurrectable handle behind. A
 * path that is not a legal session target answers false here and is left for the
 * delete itself to reject with its own error frame — one refusal, one reporter.
 * @param file - the path the surface sent.
 * @param open - the open session's log, or undefined when there is none.
 */
function targetsOpenSession(file: string, open: string | undefined): boolean {
  if (open === undefined) return false;
  try {
    return sessionLogPath(file) === open;
  } catch {
    return false;
  }
}
