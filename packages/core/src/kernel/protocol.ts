/**
 * The kernel event protocol — what every surface consumes.
 *
 * `KernelEvent` is a superset of the raw `AgentEvent` stream (the 11 loop
 * variants pass through unchanged): it folds in the channels that used to be
 * bypass callbacks and shell-local guesses — approvals (request/response with
 * a correlation id), generation phase, live tool output, nested-subagent
 * progress, background-job transitions, the running prompt queue, compaction
 * progress and operational notices. A surface that only switches on
 * `event.type` can drive the whole product; nothing outside this protocol is
 * observable, which is what makes surfaces replaceable (TUI, web, bot,
 * headless) and testable against one reducer.
 *
 * Shape and semantics live here; copy, colors and layout never do — a
 * `notice` carries a stable `code` plus a renderable fallback `text`, and
 * each surface decides whether to translate the code or print the text.
 */
import type { AgentEvent, UserMessage } from '../types.js';
import type { ApprovalRequest, ApprovalResolution } from '../approval.js';
import type { JobSnapshot } from '../jobs.js';
import type { RunStats } from './metrics.js';
import type { SubagentProgress } from '../tools/subagent.js';

/** What the agent is doing right now (drives live rows: spinner verb, web pulse). */
export type TurnPhase =
  | 'idle'
  | 'thinking'
  | 'writing'
  | 'tool'
  | 'waiting_approval'
  | 'compacting'
  | 'retrying';

/** Stable machine codes for operational notices (text is the fallback rendering). */
export type NoticeCode =
  /** A per-request (headless) auto-compaction succeeded — the success line for
   *  runs whose compaction never surfaces as a `compaction` event. */
  | 'compacted'
  /** Auto-compact ran and the retained floor is STILL over the limit: fused off for this session. */
  | 'compact_fused'
  /** A plugin hook replaced the messages array, so in-place compaction was disarmed. */
  | 'compact_alias_broken'
  /** An automatic compaction attempt threw (run continues uncompressed). */
  | 'compact_failed'
  /** A surface's event consumer fell behind MAX_LAG and its window was reset. */
  | 'surface_lagged';

/** A compaction pass, start → done|error, with the outcome bits a surface renders. */
export interface CompactionProgress {
  state: 'start' | 'done' | 'error';
  trigger: 'auto' | 'manual';
  /** Retained recent messages (state 'done'). */
  retained?: number;
  /** Summary length in chars (state 'done'). */
  summaryChars?: number;
  /** Failure reason (state 'error'). */
  error?: string;
}

export type KernelEvent =
  | AgentEvent
  /**
   * A user prompt committed to the log (right when `prompt()` is called —
   * queued or immediate — "model-visible means logged"). Surfaces render the
   * transcript row from this event instead of echoing locally, so queue
   * flush, reconnect replay and multi-consumer views stay consistent.
   */
  | { type: 'user_message'; message: UserMessage }
  /** Phase transitions, emitted only on change. */
  | { type: 'phase'; phase: TurnPhase }
  /**
   * An approval ask reached the surface: answer it via
   * `AgentSession.resolveApproval(request.id, ...)`. Serialized by the
   * permission engine — at most one outstanding request at a time.
   */
  | { type: 'approval_request'; request: ApprovalRequest }
  /**
   * A request stopped waiting (user answered, run aborted, or session
   * closed) — surfaces clear their modal by this, never by racing resolve().
   */
  | { type: 'approval_resolved'; id: string; resolution: ApprovalResolution }
  /** Live tail line from a running tool (bash output etc.). */
  | { type: 'tool_progress'; callId: string | undefined; text: string }
  /** Nested subagent lifecycle moment (foreground and background modes). */
  | { type: 'subagent_update'; progress: SubagentProgress }
  /** A background job changed state (start / settle / stop requested). */
  | { type: 'job_update'; job: JobSnapshot }
  /** The pending prompt queue changed (enqueue / flush). */
  | { type: 'queue_update'; items: readonly string[] }
  /** An automatic compaction pass made progress. */
  | { type: 'compaction'; progress: CompactionProgress }
  /**
   * The run loop threw — after the abandoned turn's log was repaired.
   * `aborted: true` means the user asked to stop (the loop unwound with it);
   * surfaces distinguish that from a real failure the same way they did when
   * each runner classified it locally.
   */
  | { type: 'run_failed'; message: string; aborted: boolean }
  /** The run is over: its timings and token totals (never logged, never model-visible). */
  | { type: 'run_stats'; stats: RunStats }
  /** Operational line (auto-compact fuse/alias/failure). */
  | { type: 'notice'; code: NoticeCode; text: string };
