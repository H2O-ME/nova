/**
 * One request's window snapshot, asked over a `context_window` frame.
 *
 * Pure (returns a Promise); the cards call it on demand (a click) rather than
 * on mount, because every open row is a fresh walk over the named session's
 * log and there is no reason to pay for one until a reader asks. The frame
 * replaces the old `/api/context-window` GET; the host re-validates the path
 * against the sessions root exactly as it did for the route.
 */
import type { ContextWindowSnapshot } from '../types.js';
import { requestFrame } from '../client/requests.js';

/** Query the host for the window at `seq` in session `sessionFile`. */
export async function fetchContextWindow(
  sessionFile: string,
  seq: number,
): Promise<ContextWindowSnapshot | undefined> {
  try {
    // 回帧没有关联字段：并发点开多行时按回帧类型排队（requests.ts），本地
    // IPC 的串行代价可忽略，换来的归属无歧义。
    const reply = await requestFrame({ type: 'context_window', session: sessionFile, seq }, 'context_window');
    if (reply === undefined || reply.ok !== true || reply.snapshot === undefined) return undefined;
    return reply.snapshot;
  } catch {
    return undefined;
  }
}
