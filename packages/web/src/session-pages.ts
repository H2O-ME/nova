/**
 * The two windows a client walks back through: the transcript baseline (`ready`
 * ships its tail, `load_earlier` walks back) and the durable log's rows (the
 * 轨迹 view's `load_trace`). They are cut on the SAME session at the SAME
 * moment — an attach or a switch — which is why they live together: the
 * controller stopping one without the other would leave a client paging a
 * window from a session it no longer has open.
 *
 * Why a window at all: the browser pages backwards with a cursor measured
 * against what it already holds, so the array those indices point into must not
 * move. Live events append to the log — and to the client's live area — but
 * never to this snapshot.
 */
import type { AgentSession, SessionEvent, ToolViewSource } from '@nova-agent/core';
import { LogWindow } from './baseline.js';
import { projectTrace } from './trace.js';
import { projectTranscript } from './transcript.js';
import { HISTORY_TAIL, TRACE_TAIL, type WireBlock, type WireTraceRow } from './protocol.js';

/** What the client holds after a page: the batch, and how many exist in all. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** The numbers `ready` publishes about the two windows. */
export interface WindowCuts {
  readonly history: readonly WireBlock[];
  readonly historyTotal: number;
  readonly traceTotal: number;
}

export class SessionPages {
  private readonly transcript = new LogWindow<WireBlock>(HISTORY_TAIL);
  private readonly traceWindow = new LogWindow<WireTraceRow>(TRACE_TAIL);

  /** Freeze both windows on the session now in force. */
  cut(agent: AgentSession, tools: readonly ToolViewSource[]): WindowCuts {
    const { tail, total } = this.transcript.refresh(projectTranscript(agent.messages, tools, agent.session.events));
    return { history: tail, historyTotal: total, traceTotal: this.traceWindow.refresh(projectTrace(agent.session.events)).total };
  }

  /** The transcript blocks immediately older than the `have` newest ones. */
  earlierThan(have: number): Page<WireBlock> {
    return { items: this.transcript.earlierThan(have), total: this.transcript.total };
  }

  /**
   * One page of the durable log. `have: 0` re-reads it — that is what opening
   * the view means (the client holds nothing, so there is no window to page
   * against) — and any other cursor pages against the window that read froze,
   * so a page can never repeat a row the client already has.
   */
  trace(have: number, events: readonly SessionEvent[]): Page<WireTraceRow> {
    if (have === 0) {
      const { tail, total } = this.traceWindow.refresh(projectTrace(events));
      return { items: tail, total };
    }
    return { items: this.traceWindow.earlierThan(have), total: this.traceWindow.total };
  }
}