/**
 * The 任务 tab's read: the live session's background jobs, as state.
 *
 * Output-free on purpose. `JobRegistry.readOutput` is a CONSUMING cursor move —
 * it is the model's `jobs` tool that drains a running command's log — so a panel
 * that read through it would eat the model's output. The one-line `progress`
 * sample is the peek designed for live rows, and it is what a row carries; the
 * verb a row offers (停止) is the existing `stop_job` frame, so this module only
 * ever answers.
 */
import type { JobRegistry } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { WsConnection } from './ws.js';

/** What this frame needs from the controller. */
export interface JobHost {
  /** The kernel's background-job registry. */
  jobs: JobRegistry;
  /** The live session: jobs belong to it and are listed for it alone. */
  sessionId: string;
}

/**
 * Answer `list_jobs` with the live session's jobs, in start order.
 * @param client - the socket to answer.
 * @param host - the controller's own collaborators.
 */
export function handleJobFrame(client: WsConnection, host: JobHost): void {
  const items = host.jobs.list(host.sessionId).map((snapshot) => ({
    id: snapshot.id,
    kind: snapshot.kind,
    label: snapshot.label,
    status: snapshot.status,
    ...(snapshot.detail !== undefined ? { detail: snapshot.detail } : {}),
    ...(snapshot.startedAt !== undefined ? { startedAt: snapshot.startedAt } : {}),
    ...(snapshot.progress !== undefined ? { progress: snapshot.progress } : {}),
  }));
  client.send(serialize({ type: 'jobs', items }));
}
