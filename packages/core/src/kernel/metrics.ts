/**
 * Per-run timing and throughput (M11 批6, surfaces' stats rows).
 *
 * A surface that wants to say "用时 13分59秒 · 首 token 5.6秒 · 42 tok/s" —
 * or to split a session's wall clock into provider time and tool time — needs
 * to know WHEN things happened, and the event stream deliberately carries no
 * timestamps (an event is protocol, not telemetry). So the timings are taken
 * where the events are already passing through once: `AgentSession.consume`.
 *
 * One run = one user prompt → its final answer, which may span several loop
 * iterations (`turn_start` … tools … `turn_start` …). Within it:
 *   - `llmMs` accumulates each provider request (`turn_start` → its `usage`),
 *     so a run that spent its time in tools does not look like model latency;
 *   - `toolMs` accumulates each call (`tool_call_start` → `tool_call_result`);
 *   - `firstTokenMs` is the run's time-to-first-token, the number a user
 *     actually feels — it excludes queueing and the request's own preamble;
 *   - `retries` counts in-flight re-requests (`llm_retry`), which is why the
 *     reported duration can exceed the sum of the parts.
 *
 * Token counters sum the run's per-request `usage` reports. Nothing here is
 * model-visible or persisted: stats ride a `run_stats` event and die with the
 * surface (a resumed session starts counting at its own first run).
 */

/**
 * One run's timing and token summary. Emitted when the run ends — after
 * `done`, or after `run_failed` with whatever the abandoned run had
 * accumulated. Observability only: never logged, never model-visible, so a
 * surface can render throughput and split its session clock into model time
 * and tool time without re-deriving any of it from deltas.
 */
export interface RunStats {
  /** Wall-clock start (ms epoch) and total duration of the run. */
  startedAt: number;
  durationMs: number;
  /** Time to the run's first streamed token; absent when none arrived. */
  firstTokenMs?: number;
  /** Time inside provider requests / inside tool calls (both exclude waiting on approvals). */
  llmMs: number;
  toolMs: number;
  /** Provider requests (loop iterations) in the run, tool calls executed, in-flight re-requests. */
  requests: number;
  toolCalls: number;
  retries: number;
  /** Summed over the run's per-request usage reports. */
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

/** Accumulates one run's timings. Injectable clock keeps it testable. */
export class RunMeter {
  private startedAt = 0;
  private firstTokenAt: number | undefined;
  private requestStartAt: number | undefined;
  private llmMs = 0;
  private toolMs = 0;
  private readonly toolStarts = new Map<string, number>();
  private requests = 0;
  private toolCalls = 0;
  private retries = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private cachedTokens = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Begin a run: every counter resets, the clock starts. */
  start(): void {
    this.startedAt = this.now();
    this.firstTokenAt = undefined;
    this.requestStartAt = undefined;
    this.llmMs = 0;
    this.toolMs = 0;
    this.toolStarts.clear();
    this.requests = 0;
    this.toolCalls = 0;
    this.retries = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.cachedTokens = 0;
  }

  /** Fold one event into the run's numbers (called once, in consume()). */
  observe(event: { type: string } & Record<string, unknown>): void {
    switch (event.type) {
      case 'turn_start':
        this.requests += 1;
        this.requestStartAt = this.now();
        break;
      case 'usage': {
        const usage = event['usage'] as { promptTokens: number; completionTokens: number; cachedTokens: number };
        this.promptTokens += usage.promptTokens;
        this.completionTokens += usage.completionTokens;
        this.cachedTokens += usage.cachedTokens;
        // The request this usage belongs to is over; a usage event with no
        // open request (a replay, a provider that reports late) adds nothing.
        if (this.requestStartAt !== undefined) {
          this.llmMs += this.now() - this.requestStartAt;
          this.requestStartAt = undefined;
        }
        break;
      }
      case 'text_delta':
      case 'reasoning_delta':
        this.firstTokenAt ??= this.now();
        break;
      case 'tool_call_start': {
        const call = event['call'] as { id: string };
        this.toolCalls += 1;
        this.toolStarts.set(call.id, this.now());
        break;
      }
      case 'tool_call_result': {
        const call = event['call'] as { id: string };
        const startedAt = this.toolStarts.get(call.id);
        if (startedAt !== undefined) {
          this.toolMs += this.now() - startedAt;
          this.toolStarts.delete(call.id);
        }
        break;
      }
      case 'llm_retry':
        this.retries += 1;
        // The failed attempt's request is still open: leave requestStartAt
        // alone so the retry's own usage closes the pair exactly once.
        break;
      default:
        break;
    }
  }

  /** The run's summary. Safe to call at any point (a failed run reports partials). */
  finish(): RunStats {
    const endedAt = this.now();
    return {
      startedAt: this.startedAt,
      durationMs: Math.max(0, endedAt - this.startedAt),
      ...(this.firstTokenAt !== undefined ? { firstTokenMs: Math.max(0, this.firstTokenAt - this.startedAt) } : {}),
      llmMs: this.llmMs,
      toolMs: this.toolMs,
      requests: this.requests,
      toolCalls: this.toolCalls,
      retries: this.retries,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      cachedTokens: this.cachedTokens,
    };
  }
}
