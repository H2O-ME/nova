/**
 * The replay baseline (M11 批6): a session's whole projected transcript, held
 * server-side so `ready` can ship only its tail.
 *
 * Why freeze it: the browser pages backwards with a cursor measured against
 * what it already holds, so the array those indices point into must not move.
 * Live events append to the log — and to the client's live area — but never to
 * this snapshot; a session switch (or a reconnect) recomputes it, which is
 * exactly when the client's cursor is reset too.
 *
 * Projecting the whole conversation on every `ready` is deliberate: the cost
 * is one pass over messages the controller already holds, and the alternative
 * (an incremental projection) would have to mirror the log's compaction
 * rewrites to stay correct.
 */
import { projectTranscript } from './transcript.js';
import { HISTORY_TAIL, type WireBlock } from './protocol.js';
import type { AgentMessage, ToolViewSource } from '@nova-agent/core';

export class HistoryBaseline {
  private blocks: WireBlock[] = [];

  /** Re-project the log and return the tail a `ready` frame should carry. */
  refresh(messages: readonly AgentMessage[], tools: readonly ToolViewSource[]): { tail: WireBlock[]; total: number } {
    this.blocks = projectTranscript(messages, tools);
    return { tail: this.blocks.slice(-HISTORY_TAIL), total: this.blocks.length };
  }

  get total(): number {
    return this.blocks.length;
  }

  /**
   * The batch immediately older than the `have` newest blocks. A client that
   * already holds everything (or asks past the start) gets an empty batch
   * rather than an error: "no more history" is an answer, not a failure.
   */
  earlierThan(have: number): WireBlock[] {
    const end = Math.max(0, this.blocks.length - have);
    return this.blocks.slice(Math.max(0, end - HISTORY_TAIL), end);
  }
}
