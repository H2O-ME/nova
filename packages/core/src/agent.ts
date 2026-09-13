import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newId } from './ids.js';
import { formatJobNotices, type JobRegistry } from './jobs.js';
import type {
  AgentEvent,
  AgentHooks,
  AgentMessage,
  AssistantMessage,
  ChatProvider,
  ChatRequest,
  ToolCall,
  ToolDefinition,
  ToolDispatchCall,
  ToolDispatchResult,
  ToolResultMessage,
  Usage,
  UsageStats,
  UserMessage,
} from './types.js';

/** The nested-dispatch seam exposed to tools through ToolExecuteContext. */
export type ToolDispatcher = (call: ToolDispatchCall, signal?: AbortSignal) => Promise<ToolDispatchResult>;

/**
 * Empty-completion re-issues per turn before the run errors out (see the
 * retry loop in runAgent): 1 real attempt + 2 retries.
 */
export const EMPTY_COMPLETION_MAX_RETRIES = 2;

export interface AgentOptions {
  provider: ChatProvider;
  /** Append-only message log; the loop appends new messages to this array. */
  messages: AgentMessage[];
  rootDir: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** Loop interception points; the plugin host composes plugins into this. */
  hooks?: AgentHooks;
  maxTurns?: number;
  /** Tool results larger than this are offloaded to cacheDir. */
  maxToolResultBytes?: number;
  cacheDir?: string;
  /** Background-job registry exposed to tools through ToolExecuteContext. */
  jobs?: JobRegistry;
  /** Session-event sink exposed to tools (log-only events like todo/write). */
  emit?: (evt: import('./session.js').SessionEvent) => void | Promise<void>;
  /**
   * Live progress feed from long-running tools (bash stdout tail etc.).
   * Purely presentational: the loop never waits on it and drops it silently
   * when unset.
   */
  onToolProgress?: (text: string) => void;
  signal?: AbortSignal;
}

/** Exported so UIs can display the effective limit in hints. */
export const DEFAULT_MAX_TURNS = 30;
const DEFAULT_MAX_TOOL_RESULT_BYTES = 40 * 1024;
/** How long a running tool may keep the turn open after the user aborted. */
const ABORT_GRACE_MS = 2_000;

/**
 * Appended to the log when a run is cut short by abort (codex-style
 * <turn_aborted> marker): without it the model has no way to learn that the
 * previous turn ended mid-work and that tools may have partially executed.
 */
export const TURN_ABORTED_GUIDANCE =
  'The user interrupted the previous turn on purpose. It may have ended mid-task: tools or commands from that turn might have partially executed, so verify the current state before continuing.';

const SKIPPED_BY_ABORT = '[not executed: the user interrupted this turn]';

/**
 * Synthesized for tool calls whose result never landed because the consumer
 * abandoned the run mid-turn (runner event handler threw → for-await called
 * .return() on this generator). Keeps the one-result-per-call contract: an
 * assistant message with unanswered tool_calls would 400 the next request on
 * strict providers and stay unbalanced across resume/compact.
 */
export const NOT_EXECUTED_GUIDANCE = '[not executed: the turn ended before this call ran]';

export function emptyStats(): UsageStats {
  return { turns: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, missTokens: 0, missTurns: 0 };
}

/**
 * Per-turn misses at or below this are breakpoint-granularity noise (pi
 * cache-stats), not a real prefix invalidation.
 */
export const CACHE_MISS_NOISE_FLOOR_TOKENS = 1024;

/**
 * Appended to the log for every tool call of an assistant message that was
 * cut off by the output token limit (pi-style length defense): streamed
 * arguments are salvaged best-effort, so they may parse and validate but be
 * silently incomplete. None of the batch is safe to execute; failing them all
 * lets the model re-issue complete calls instead of wasting a turn on a
 * half-specified command.
 */
export const LENGTH_CUTOFF_TOOL_GUIDANCE =
  'not executed: the response hit the output token limit, so the arguments may be truncated. Re-issue the tool call with complete arguments.';

/**
 * Per-run bookkeeping for the job-notice at-least-once delivery contract
 * (drained per request; requeued on every path that ends without the
 * assistant reply committing).
 */
interface NoticeState {
  unaccounted: ReturnType<JobRegistry['drainFinished']>;
  consumed: boolean;
}

/** Requeue drained-but-unannounced notices exactly once (idempotent). */
function requeueUnaccounted(opts: AgentOptions, notices: NoticeState): void {
  if (!notices.consumed) {
    opts.jobs?.requeue(notices.unaccounted);
    notices.consumed = true;
  }
}

/**
 * Request assembly for one turn. Finished-job notices are injected AFTER the
 * hook chain on purpose. The beforeLLMCall hooks (notably exec's in-place
 * auto-compact) assume request.messages aliases opts.messages — a shared
 * reference they splice to shrink the outer log. Injecting a clone before them
 * would swallow that splice (the outer array would never shrink and every
 * following turn would re-compact). Here the hook first sees the clean
 * append-only log; the notice then becomes an ephemeral tail on a fresh clone,
 * so it reaches the model but never the log (resume/compact unaffected) and
 * the drain-once registry queue still announces each job exactly once.
 * Delivery is at-least-once though: if this request dies before its assistant
 * reply commits (network exhausted, context-window 400…), the drained notices
 * go back on the queue — announce-zero would silently strand the task.
 */
async function assembleRequest(opts: AgentOptions, notices: NoticeState): Promise<ChatRequest> {
  let request: ChatRequest = {
    messages: opts.messages,
    systemPrompt: opts.systemPrompt,
    tools: opts.tools,
    signal: opts.signal,
  };
  if (opts.hooks?.beforeLLMCall) request = await opts.hooks.beforeLLMCall(request);
  notices.unaccounted = opts.jobs?.drainFinished() ?? [];
  notices.consumed = notices.unaccounted.length === 0;
  if (notices.unaccounted.length > 0) {
    const notice: UserMessage = {
      id: newId('msg'),
      ts: Date.now(),
      role: 'user',
      content: formatJobNotices(notices.unaccounted),
    };
    request = { ...request, messages: [...request.messages, notice] };
  }
  return request;
}

/** Per-turn accumulators handed back once a completion streams in full. */
type StreamOutcome =
  | { interrupted: true }
  | {
      interrupted: false;
      content: string;
      finishReason: string | undefined;
      usage: Usage | undefined;
      partialCalls: Map<number, { id?: string; name?: string; args: string }>;
    };

/**
 * Stream one assistant completion, with the empty-completion retry loop. A
 * completion with NO text, NO tool calls and a finish reason is a provider
 * pathology, not a valid turn: the old behavior logged a phantom EMPTY
 * assistant message and ended the run "complete" — the caller saw thinking
 * stop and then silence with no error. Re-issue the IDENTICAL request (built
 * once per turn: re-draining job notices here would return [] and silently
 * drop them from the retry; the stable prefix also keeps the retry cache-warm).
 * Retries exhausted → hard error so every runner surfaces it.
 */
async function* streamCompletion(
  opts: AgentOptions,
  request: ChatRequest,
  messageId: string,
  stats: UsageStats,
  notices: NoticeState,
): AsyncGenerator<AgentEvent, StreamOutcome> {
  let content = '';
  let finishReason: string | undefined;
  let usage: Usage | undefined;
  const partialCalls = new Map<number, { id?: string; name?: string; args: string }>();
  let emptyRetries = 0;
  for (;;) {
    content = '';
    partialCalls.clear();
    finishReason = undefined;
    usage = undefined;
    // Cumulative stats as of the start of the in-flight attempt: a provider
    // reset rolls the running stats back to this snapshot, discarding usage
    // reported by the failed attempt.
    const attemptStats: UsageStats = { ...stats };

    // An abort surfaces either as the signal firing between events or as an
    // AbortError thrown by the provider; both end the run the same way.
    let interrupted = false;
    try {
      for await (const ev of opts.provider.stream(request)) {
        if (opts.signal?.aborted) {
          interrupted = true;
          break;
        }
        switch (ev.type) {
          case 'reset': {
            // The provider discarded this attempt's response and is
            // re-requesting: roll every accumulator back so the replay starts
            // from a clean slate (partial text, tool-call deltas, usage and
            // finish reason all belonged to the failed attempt).
            content = '';
            partialCalls.clear();
            finishReason = undefined;
            usage = undefined;
            Object.assign(stats, attemptStats);
            yield {
              type: 'llm_retry',
              attempt: ev.attempt,
              maxRetries: ev.maxRetries,
              error: ev.error,
              stats: { ...stats },
            };
            break;
          }
          case 'text_delta': {
            content += ev.text;
            yield { type: 'text_delta', messageId, text: ev.text };
            break;
          }
          case 'reasoning_delta': {
            // Observability only: reasoning is never accumulated into the
            // message log, so the persisted prefix stays byte-stable.
            yield { type: 'reasoning_delta', text: ev.text };
            break;
          }
          case 'tool_call_delta': {
            let partial = partialCalls.get(ev.index);
            if (!partial) {
              partial = { args: '' };
              partialCalls.set(ev.index, partial);
            }
            // Empty strings are treated as absent: some gateways repeat
            // id/name as "" on argument-delta chunks.
            if (ev.id !== undefined && ev.id.length > 0) partial.id = ev.id;
            if (ev.name !== undefined && ev.name.length > 0) partial.name = ev.name;
            if (ev.argsDelta !== undefined) partial.args += ev.argsDelta;
            break;
          }
          case 'usage': {
            usage = ev.usage;
            stats.promptTokens += ev.usage.promptTokens;
            stats.completionTokens += ev.usage.completionTokens;
            stats.cachedTokens += ev.usage.cachedTokens;
            // Cache-waste audit: once the provider has reported any cache
            // activity, a turn whose prompt exceeded its cache read by more
            // than the noise floor paid full price for the difference.
            const miss = ev.usage.promptTokens - ev.usage.cachedTokens;
            if (stats.cachedTokens > 0 && miss > CACHE_MISS_NOISE_FLOOR_TOKENS) {
              stats.missTokens += miss;
              stats.missTurns += 1;
            }
            yield { type: 'usage', usage: ev.usage, stats: { ...stats } };
            break;
          }
          case 'finish': {
            if (ev.finishReason !== undefined) finishReason = ev.finishReason;
            break;
          }
        }
      }
    } catch (err) {
      // The model never answered this request: hand the drained notices back
      // before the error escapes (the registry outlives the run in
      // interactive mode, so the next run re-announces them).
      requeueUnaccounted(opts, notices);
      // Once the user asked to stop, unwind as an interruption regardless of
      // which error the abort raced with.
      if (!opts.signal?.aborted) throw err;
      interrupted = true;
    }
    if (interrupted) {
      // The partial response is discarded, so from the log's point of view the
      // model never saw the notice either.
      requeueUnaccounted(opts, notices);
      yield* finishAborted(opts);
      return { interrupted: true };
    }
    const emptyCompletion =
      content.length === 0 && partialCalls.size === 0 && finishReason !== undefined;
    if (!emptyCompletion || opts.signal?.aborted) break;
    emptyRetries += 1;
    if (emptyRetries > EMPTY_COMPLETION_MAX_RETRIES) {
      // The job notices rode every failed request, but no assistant reply was
      // ever committed — hand them back so the next run re-announces them
      // (at-least-once delivery).
      requeueUnaccounted(opts, notices);
      throw new Error(
        `model returned an empty completion ${EMPTY_COMPLETION_MAX_RETRIES + 1} times in a row (finish_reason: ${finishReason}; output likely went entirely to reasoning_content)`,
      );
    }
    yield {
      type: 'empty_completion',
      attempt: emptyRetries,
      maxRetries: EMPTY_COMPLETION_MAX_RETRIES,
      finishReason: finishReason!,
    };
  }
  return { interrupted: false, content, finishReason, usage, partialCalls };
}

/**
 * The agent loop as an async generator of standardized events.
 * REPL, TUI and non-interactive runners all consume the same stream.
 */
export async function* runAgent(opts: AgentOptions): AsyncGenerator<AgentEvent> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxBytes = opts.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES;
  const stats = emptyStats();
  // Hoisted so the abandonment finally (consumer threw mid-event → the
  // for-await unwound this iterator) can still honor the notice contract.
  const notices: NoticeState = { unaccounted: [], consumed: true };

  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      if (opts.signal?.aborted) {
        yield* finishAborted(opts);
        return;
      }
      stats.turns = turn;
      yield { type: 'turn_start', turn };

      const messageId = newId('msg');
      const request = await assembleRequest(opts, notices);
      const outcome = yield* streamCompletion(opts, request, messageId, stats, notices);
      if (outcome.interrupted) return;

      const toolCalls: Array<ToolCall & { argsOk: boolean }> = [...outcome.partialCalls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, partial]) => {
          const { args, ok } = parseArgs(partial.args);
          return {
            id: partial.id ?? newId('call'),
            name: partial.name ?? 'unknown',
            args,
            rawArgs: partial.args,
            argsOk: ok,
          };
        });

      const assistant: AssistantMessage = {
        id: messageId,
        ts: Date.now(),
        role: 'assistant',
        content: outcome.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(outcome.usage ? { usage: outcome.usage } : {}),
        ...(outcome.finishReason !== undefined ? { finishReason: outcome.finishReason } : {}),
      };
      opts.messages.push(assistant);
      // The model answered — the announcement has landed and stays consumed.
      notices.consumed = true;
      yield { type: 'message', message: assistant };

      if (toolCalls.length === 0) {
        yield { type: 'done', stopReason: 'complete' };
        return;
      }

      // A "length" stop means the output was cut off by the token limit, so
      // every tool call in the batch may carry silently-truncated arguments.
      // Fail them all (the loop continues, so the model can re-issue them).
      if (outcome.finishReason === 'length') {
        for (const call of toolCalls) {
          const result: ToolResultMessage = {
            id: newId('msg'),
            ts: Date.now(),
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: `Tool call "${call.name}" ${LENGTH_CUTOFF_TOOL_GUIDANCE}`,
          };
          opts.messages.push(result);
          yield { type: 'tool_call_result', turn, call, result };
        }
        continue;
      }

      // Malformed-argument defense: arguments that never parsed as JSON would
      // silently execute with {} (a fabricated empty plan). Fail just those
      // calls with an explicit result; the well-formed rest run on.
      const malformed = toolCalls.filter((call) => !call.argsOk);
      if (malformed.length > 0) {
        for (const call of malformed) {
          const result: ToolResultMessage = {
            id: newId('msg'),
            ts: Date.now(),
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: `Tool call "${call.name}" was not executed: the streamed arguments were not valid JSON. Re-issue the tool call with well-formed JSON arguments.`,
          };
          opts.messages.push(result);
          yield { type: 'tool_call_result', turn, call, result };
        }
      }
      const executable = toolCalls.filter((call) => call.argsOk);
      if (executable.length === 0) continue;

      const toolByName = new Map((opts.tools ?? []).map((tool) => [tool.name, tool]));
      yield* runToolCalls(executable, toolByName, turn, opts, maxBytes, makeDispatcher(opts, toolByName));
    }

    yield { type: 'done', stopReason: 'max_turns' };
  } finally {
    // Abandonment cleanup: when the consumer throws mid-event, the for-await
    // closes this generator via .return() and unwinds here — no in-band error
    // handler runs. Two contracts to honor: (1) drained-but-unannounced job
    // notices go back on the queue so a later run re-announces them;
    // (2) an assistant message already pushed with unanswered tool_calls gets
    // its missing results synthesized (NOT_EXECUTED_GUIDANCE), keeping the
    // one-result-per-call surface contract even when the run died in the
    // consumer, not the loop. On every in-band exit the surface is already
    // balanced, so the synthesis is a no-op there.
    requeueUnaccounted(opts, notices);
    synthesizeMissingToolResults(opts.messages);
  }
}

/** Fill in a NOT_EXECUTED_GUIDANCE result for every callId missing one. */
function synthesizeMissingToolResults(messages: AgentMessage[]): void {
  const answered = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool') answered.add(msg.toolCallId);
  }
  const missing: ToolResultMessage[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || msg.toolCalls === undefined) continue;
    for (const call of msg.toolCalls) {
      if (answered.has(call.id)) continue;
      answered.add(call.id);
      missing.push({
        id: newId('msg'),
        ts: Date.now(),
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: NOT_EXECUTED_GUIDANCE,
      });
    }
  }
  messages.push(...missing);
}

interface ToolSegment {
  calls: ToolCall[];
  parallel: boolean;
}

/**
 * Split the batch into maximal runs of adjacent calls that all opted into
 * concurrent dispatch (dsh's isConcurrencySafe classifier). A batch with no
 * opt-ins produces one serial segment per call — identical to the old
 * strictly serial behavior.
 */
function splitToolSegments(calls: ToolCall[], toolByName: Map<string, ToolDefinition>): ToolSegment[] {
  const segments: ToolSegment[] = [];
  for (const call of calls) {
    const safe = toolByName.get(call.name)?.isConcurrencySafe?.(call.args) === true;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.parallel === safe) {
      last.calls.push(call);
    } else {
      segments.push({ calls: [call], parallel: safe });
    }
  }
  return segments;
}

/**
 * Execute one batch of tool calls. Segments whose calls all declare
 * `isConcurrencySafe` execute concurrently (after serial pre-flight of
 * approval/hooks), but results are appended to the log and yielded in
 * original call order so the message log stays deterministic. Serial
 * segments keep strict per-call pre-flight → execute ordering so an abort
 * fired by an earlier tool still skips the queued ones.
 */
async function* runToolCalls(
  toolCalls: ToolCall[],
  toolByName: Map<string, ToolDefinition>,
  turn: number,
  opts: AgentOptions,
  maxBytes: number,
  dispatch: ToolDispatcher,
): AsyncGenerator<AgentEvent> {
  for (const segment of splitToolSegments(toolCalls, toolByName)) {
    if (!segment.parallel) {
      for (const call of segment.calls) {
        yield { type: 'tool_call_start', turn, call };
        const verdict = await preflightToolCall(call, opts);
        if (verdict.kind === 'skip') {
          yield abortedSkipResult(opts, call, turn);
          continue;
        }
        if (verdict.kind === 'deny') {
          yield {
            type: 'tool_call_result',
            turn,
            call,
            result: deniedResult(opts, call, verdict.content),
          };
          continue;
        }
        const result = await completeToolCall(verdict.effective, opts, maxBytes, toolByName, dispatch);
        opts.messages.push(result);
        yield { type: 'tool_call_result', turn, call: verdict.effective, result };
      }
      continue;
    }

    const approved: { call: ToolCall; effective: ToolCall }[] = [];
    for (const call of segment.calls) {
      yield { type: 'tool_call_start', turn, call };
      const verdict = await preflightToolCall(call, opts);
      if (verdict.kind === 'skip') {
        yield abortedSkipResult(opts, call, turn);
        continue;
      }
      if (verdict.kind === 'deny') {
        yield {
          type: 'tool_call_result',
          turn,
          call,
          result: deniedResult(opts, call, verdict.content),
        };
        continue;
      }
      approved.push({ call, effective: verdict.effective });
    }

    if (approved.length === 0) continue;
    const pending = approved.map((entry) => completeToolCall(entry.effective, opts, maxBytes, toolByName, dispatch));
    // allSettled: one failing call (e.g. a spill-to-disk error) must not leak
    // an unhandled rejection from the siblings nobody awaits anymore — the
    // run would crash mid-turn with an unbalanced log (assistant tool_calls
    // without their result messages). Every slot resolves to a result.
    const settled = await Promise.allSettled(pending);
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i]!;
      const call = approved[i]!.effective;
      let result: ToolResultMessage;
      if (outcome.status === 'fulfilled') {
        result = outcome.value;
      } else {
        const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        result = {
          id: newId('msg'),
          ts: Date.now(),
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: `Error: tool result could not be recorded (${reason})`,
        };
      }
      opts.messages.push(result);
      yield { type: 'tool_call_result', turn, call, result };
    }
  }
}

type PreflightVerdict =
  | { kind: 'skip' }
  | { kind: 'deny'; content: string }
  | { kind: 'run'; effective: ToolCall };

/**
 * Hook/permission/abort gate for one call, before any execution. Mirrors the
 * pre-execution half of the old serial loop: denied calls produce a result
 * message, aborted calls are recorded as skipped.
 */
async function preflightToolCall(call: ToolCall, opts: AgentOptions): Promise<PreflightVerdict> {
  // Queued-but-unstarted tools are recorded as skipped so the assistant
  // tool_calls keep their required result messages.
  if (opts.signal?.aborted) return { kind: 'skip' };

  let effective = call;
  if (opts.hooks?.beforeToolCall) {
    const verdict = await opts.hooks.beforeToolCall(call);
    if (verdict.action === 'deny') {
      const reason = verdict.reason !== undefined && verdict.reason.length > 0 ? `: ${verdict.reason}` : '';
      return { kind: 'deny', content: `Permission denied${reason}` };
    }
    // Trust seam: the rewrite lands AFTER the permission gate inside
    // beforeToolCall has already judged the ORIGINAL args — the rewritten
    // call is not re-gated (host.ts composes gate then hooks; no built-in
    // plugin rewrites today).
    if (verdict.action === 'rewrite' && verdict.args) {
      effective = { ...call, args: verdict.args, rawArgs: JSON.stringify(verdict.args) };
    }
  }

  // An abort that arrived while waiting on the approval prompt must not
  // run the just-approved tool.
  if (opts.signal?.aborted) return { kind: 'skip' };
  return { kind: 'run', effective };
}

function deniedResult(opts: AgentOptions, call: ToolCall, content: string): ToolResultMessage {
  const result: ToolResultMessage = {
    id: newId('msg'),
    ts: Date.now(),
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content,
  };
  opts.messages.push(result);
  return result;
}

/** Append the abort marker to the log and surface it for persistence. */
function* finishAborted(opts: AgentOptions): Generator<AgentEvent> {
  const marker: UserMessage = {
    id: newId('msg'),
    ts: Date.now(),
    role: 'user',
    content: TURN_ABORTED_GUIDANCE,
  };
  opts.messages.push(marker);
  yield { type: 'turn_aborted', message: marker };
  yield { type: 'done', stopReason: 'aborted' };
}

function abortedSkipResult(
  opts: AgentOptions,
  call: ToolCall,
  turn: number,
): { type: 'tool_call_result'; turn: number; call: ToolCall; result: ToolResultMessage } {
  const result: ToolResultMessage = {
    id: newId('msg'),
    ts: Date.now(),
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content: SKIPPED_BY_ABORT,
  };
  opts.messages.push(result);
  return { type: 'tool_call_result', turn, call, result };
}

/**
 * Tool-call arguments arrive as a streamed raw JSON string. Returns the parsed
 * object plus an ok flag: a failed parse must NOT silently run as {} (a
 * fabricated empty plan) — the caller turns !ok into an explicit error result
 * so the model re-issues the call. An empty string stays ok (some gateways
 * emit zero-argument calls as an empty delta).
 */
function parseArgs(raw: string): { args: Record<string, unknown>; ok: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { args: {}, ok: true };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown>, ok: true };
    }
    return { args: {}, ok: false };
  } catch {
    return { args: {}, ok: false };
  }
}

/**
 * Build the loop's nested-dispatch dispatcher (the PTC seam, dsh
 * run_code-bridge style): a sub-call runs the SAME pipeline as a native one —
 * abort checks, the beforeToolCall gate (permission service + plugin hooks),
 * tool execution with per-tool timeout and abort grace, and the
 * afterToolResult chain — but never touches the message log; the settled text
 * is handed back to the calling tool. The optional signal overrides the run
 * signal so run_code can tie sub-calls to its own run-scoped controller
 * (budget expiry or settlement aborts in-flight work instead of orphaning it).
 */
function makeDispatcher(opts: AgentOptions, toolByName: Map<string, ToolDefinition>): ToolDispatcher {
  return async (call, signal) => {
    const subOpts = signal !== undefined ? { ...opts, signal } : opts;
    const tool = toolByName.get(call.name);
    if (tool === undefined) return { ok: false, error: `unknown tool "${call.name}"` };
    if (subOpts.signal?.aborted) return { ok: false, error: 'run is over; the call was not dispatched' };
    const sub: ToolCall = {
      id: newId('call'),
      name: call.name,
      args: call.args,
      rawArgs: JSON.stringify(call.args),
    };
    const verdict = await preflightToolCall(sub, subOpts);
    if (verdict.kind === 'skip') return { ok: false, error: 'run is over; the call was not dispatched' };
    if (verdict.kind === 'deny') return { ok: false, error: verdict.content };
    const raw = await executeTool(tool, verdict.effective, subOpts);
    const result = opts.hooks?.afterToolResult
      ? await opts.hooks.afterToolResult(verdict.effective, raw)
      : raw;
    return { ok: true, result };
  };
}

async function executeTool(
  tool: ToolDefinition | undefined,
  call: ToolCall,
  opts: AgentOptions,
  dispatch?: ToolDispatcher,
): Promise<string> {
  if (!tool) return `Error: unknown tool "${call.name}"`;

  const parent = opts.signal;
  let signal = parent;
  let timeoutController: AbortController | undefined;
  if (tool.timeoutMs !== undefined) {
    timeoutController = new AbortController();
    signal = parent ? AbortSignal.any([parent, timeoutController.signal]) : timeoutController.signal;
  }

  const run = (async () => {
    try {
      return await tool.execute(call.args, {
        rootDir: opts.rootDir,
        signal,
        ...(opts.jobs !== undefined ? { jobs: opts.jobs } : {}),
        ...(opts.emit !== undefined ? { emit: opts.emit } : {}),
        ...(opts.onToolProgress !== undefined ? { onProgress: opts.onToolProgress } : {}),
        ...(dispatch !== undefined ? { dispatch } : {}),
      });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();

  /**
   * The tool result is decided by whichever comes first: the run settles, the
   * per-tool timeout fires, or — after a short abort grace — the parent
   * signal (user interrupt) cuts it off. The grace lets a tool that finishes
   * right around the abort record its real result; one that ignores its
   * cancellation signal gets cut off, so Esc/Ctrl+C always ends the run
   * promptly (codex interrupt guarantee). The abandoned run keeps going in
   * the background; its value is dropped.
   */
  return new Promise<string>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let abortGrace: NodeJS.Timeout | undefined;
    const settle = (value: string): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (abortGrace !== undefined) clearTimeout(abortGrace);
      if (onAbort !== undefined) parent?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort =
      parent === undefined
        ? undefined
        : () => {
            abortGrace ??= setTimeout(
              () => settle(`Error: tool "${call.name}" aborted by user interrupt`),
              ABORT_GRACE_MS,
            );
          };
    if (tool.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timeoutController?.abort();
        settle(`Error: tool "${call.name}" timed out after ${tool.timeoutMs}ms (cancellation was requested; work that ignores the signal may still be running)`);
      }, tool.timeoutMs);
    }
    if (parent !== undefined && onAbort !== undefined) {
      if (parent.aborted) {
        onAbort();
      } else {
        parent.addEventListener('abort', onAbort, { once: true });
      }
    }
    void run.then((value) => settle(value));
  });
}

/** Execute one approved call and produce its log-ready result message. */
async function completeToolCall(
  call: ToolCall,
  opts: AgentOptions,
  maxBytes: number,
  toolByName: Map<string, ToolDefinition>,
  dispatch?: ToolDispatcher,
): Promise<ToolResultMessage> {
  let rawResult = await executeTool(toolByName.get(call.name), call, opts, dispatch);
  if (opts.hooks?.afterToolResult) {
    rawResult = await opts.hooks.afterToolResult(call, rawResult);
  }
  const { content, truncatedRef } = await storeToolResult(rawResult, maxBytes, opts);
  return {
    id: newId('msg'),
    ts: Date.now(),
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content,
    ...(truncatedRef ? { truncatedRef } : {}),
  };
}

/**
 * Tool results over the byte budget are written to disk in full and only a
 * truncated head plus tail are kept in the message log (codex-style middle
 * truncation: the head gives the summary, the tail carries the most recent
 * output such as test failure details), so the prompt prefix stays small
 * and existing messages are never rewritten. The on-disk copy is written
 * owner-exclusively (`wx`) and referenced with an explicit retrieval hint,
 * dsh spill-style.
 */
async function storeToolResult(
  raw: string,
  maxBytes: number,
  opts: AgentOptions,
): Promise<{ content: string; truncatedRef?: string }> {
  if (Buffer.byteLength(raw, 'utf8') <= maxBytes) return { content: raw };
  // The spill never lands in the workspace (zero-write rule): callers pass a
  // cacheDir under ~/.nova, and the fallback keeps that contract too.
  const cacheDir = opts.cacheDir ?? path.join(os.homedir(), '.nova', 'cache', 'tool-outputs');
  await mkdir(cacheDir, { recursive: true });
  const ref = path.join(cacheDir, `${newId('out')}.txt`);
  // 'wx' refuses to overwrite (or follow a planted symlink at) an existing path.
  await writeFile(ref, raw, { encoding: 'utf8', flag: 'wx' });
  // Keep the message body (head + hint line + tail) inside the byte budget:
  // reserve room for the hint line, then split the rest 60/40 head/tail.
  const bodyBudget = Math.max(1024, maxBytes - HINT_LINE_RESERVE_BYTES);
  const head = truncateBytes(raw, Math.floor(bodyBudget * HEAD_TAIL_RATIO));
  const tail = truncateTailBytes(raw, bodyBudget - Math.floor(bodyBudget * HEAD_TAIL_RATIO));
  const dropped = Buffer.byteLength(raw, 'utf8') - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');
  const content = `${head}\n[truncated ${dropped} bytes; full output at ${ref} — use the read tool on this path to view it]\n${tail}`;
  return { content, truncatedRef: ref };
}

/** Share of the byte budget kept as the head; the rest keeps the tail. */
const HEAD_TAIL_RATIO = 0.6;
/** Room reserved for the truncation hint line so the body stays in budget. */
const HINT_LINE_RESERVE_BYTES = 200;

function truncateBytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // do not cut inside a multi-byte UTF-8 sequence: trim trailing continuations
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

function truncateTailBytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  let start = bytes.length - maxBytes;
  // skip the partial leading UTF-8 sequence left by the cut
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return new TextDecoder().decode(bytes.subarray(start));
}
