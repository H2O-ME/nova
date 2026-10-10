/**
 * Kernel event dispatch: classify, then route to the owning domain module
 * (`client/messages.ts` for the transcript, `client/runs.ts` for run state,
 * `client/approvals.ts` inside run state). The frame-level bookkeeping (attach,
 * sessions, pagination) lives in `state.ts`; the exported types too.
 *
 * The rule every domain case follows: an event either appends a row, rewrites
 * the ONE row it belongs to, or says something in a hint. A channel the kernel
 * publishes that no case draws is a feature the user cannot see — which is why
 * the classification is exhaustive rather than the subset the first version
 * happened to need.
 */
import type { KernelEvent, ToolCallView, ToolResultView } from './types.js';
import type { UiState } from './state.js';
import { reduceTranscript, type TranscriptEvent } from './client/messages.js';
import { reduceRunState, type RunStateEvent } from './client/runs.js';

/**
 * Events the reducer deliberately does NOT draw. Keeping them as a named union
 * (rather than letting a `default:` arm swallow them) is what makes the split
 * exhaustive: the two predicates below plus this guard must cover every
 * `KernelEvent`, and `classifyEvent` ends in `assertNever`, so a new variant is a
 * compile error until it is either reduced or listed here with a reason. A bare
 * `default: return false` would instead drop it silently — the surface would look
 * complete while one channel went unrendered.
 */
type IgnoredEvent = Extract<KernelEvent, { type: 'message' | 'turn_aborted' }>;

/**
 * Why each ignored event is safe to drop, as an exhaustive record so a newly
 * ignored variant cannot be added without stating the reason.
 */
export const IGNORED_REASONS: Record<IgnoredEvent['type'], string> = {
  // The assistant turn's content already arrived as `text_delta` and was committed
  // to a block; re-drawing the committed message would double it. (Its LOG role
  // still matters — transcript replay reads it from the log, not from this live
  // channel.)
  message: '内容已随 text_delta 落地，重画会重复',
  // The kernel's marker message is model-facing scaffolding; the "已中断" line the
  // user reads comes from `run_failed` with `aborted: true`.
  turn_aborted: '面向用户的「已中断」由 run_failed 给出',
};

/**
 * Is this one of the channels the reducer deliberately does not draw? Exported so
 * `test/state.test.ts` can assert the ignored set is exactly the two events that
 * carry a stated reason, rather than an accidental gap.
 * @param event - any kernel event.
 * @returns whether this event is intentionally not reduced.
 */
export function isIgnoredEvent(event: KernelEvent): event is IgnoredEvent {
  switch (event.type) {
    case 'message':
    case 'turn_aborted':
      return true;
    default:
      return false;
  }
}

export function reduceEvent(
  state: UiState,
  event: KernelEvent,
  view: ToolCallView | undefined,
  resultView: ToolResultView | undefined,
  /** The wall clock, injected: the reducer itself stays deterministic (the two
      live stamps it writes are the only clock reads), so a test or a replay can
      pin time instead of racing it. */
  now: number = Date.now(),
): UiState {
  const next = isTranscriptEvent(event)
    ? reduceTranscript(state, event, view, resultView, now)
    : isRunStateEvent(event)
      ? reduceRunState(state, event)
      : state;
  // The kernel echoed the browser's send (a committed prompt — queued prompts
  // commit before they enqueue — or a command's run row). The draft's fate is
  // sealed as DELIVERED, so a later `error` frame about something else must not
  // restore it.
  return acceptsEcho(event) ? { ...next, awaitingEcho: false } : next;
}

/** Whether this event IS the echo the composer's send was waiting for. */
function acceptsEcho(event: KernelEvent): boolean {
  return event.type === 'user_message' || (event.type === 'command' && event.phase === 'run');
}

/**
 * Compile-time exhaustiveness: reaching this with a value means a union member
 * was not handled. The `never` parameter is the whole mechanism — adding a
 * variant to `KernelEvent` breaks the build at each unhandled switch.
 * @param value - the value that should have been impossible.
 * @returns never; it throws if the type system was bypassed at runtime.
 */
function assertNever(value: never): never {
  throw new Error(`unhandled kernel event: ${JSON.stringify(value)}`);
}

function isTranscriptEvent(event: KernelEvent): event is TranscriptEvent {
  switch (event.type) {
    case 'user_message':
    case 'text_delta':
    case 'reasoning_delta':
    case 'tool_call_start':
    case 'tool_call_result':
    case 'tool_progress':
    case 'job_update':
    case 'subagent_update':
    case 'llm_retry':
    case 'empty_completion':
    case 'command':
    case 'done':
      return true;
    default:
      // Everything else is either reduced as run state or explicitly ignored;
      // `assertNever` in the two checks below pins which.
      return false;
  }
}

function isRunStateEvent(event: KernelEvent): event is RunStateEvent {
  switch (event.type) {
    case 'turn_start':
    case 'phase':
    case 'approval_request':
    case 'approval_resolved':
    case 'question_request':
    case 'question_resolved':
    case 'queue_update':
    case 'model':
    case 'session_titled':
    case 'todo':
    case 'goal':
    case 'compaction':
    case 'notice':
    case 'run_failed':
    case 'usage':
    case 'run_stats':
      return true;
    default:
      return false;
  }
}

/**
 * The partition, asserted exhaustively. Every `KernelEvent` must be classified
 * exactly once as transcript, run state, or deliberately ignored — this is the
 * only place that guarantee is checked, and it runs at module load so a gap fails
 * loudly instead of dropping an event on the floor.
 * @param event - any kernel event.
 * @returns the channel that owns it.
 */
export function classifyEvent(event: KernelEvent): 'transcript' | 'run-state' | 'ignored' {
  if (isTranscriptEvent(event)) return 'transcript';
  if (isRunStateEvent(event)) return 'run-state';
  if (isIgnoredEvent(event)) return 'ignored';
  // Unreachable while the union and the three switches agree; a value getting
  // here means a variant was added to `KernelEvent` without a decision.
  return assertNever(event);
}
