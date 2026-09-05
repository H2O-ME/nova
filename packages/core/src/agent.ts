import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newId } from './ids.js';
import type { JobRegistry } from './jobs.js';
import type {
  AgentEvent,
  AgentHooks,
  AgentMessage,
  AssistantMessage,
  ChatProvider,
  ChatRequest,
  ToolCall,
  ToolDefinition,
  ToolResultMessage,
  Usage,
  UsageStats,
  UserMessage,
} from './types.js';

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
  signal?: AbortSignal;
}

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_MAX_TOOL_RESULT_BYTES = 40 * 1024;

/**
 * Appended to the log when a run is cut short by abort (codex-style
 * <turn_aborted> marker): without it the model has no way to learn that the
 * previous turn ended mid-work and that tools may have partially executed.
 */
export const TURN_ABORTED_GUIDANCE =
  'The user interrupted the previous turn on purpose. It may have ended mid-task: tools or commands from that turn might have partially executed, so verify the current state before continuing.';

const SKIPPED_BY_ABORT = '[not executed: the user interrupted this turn]';

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
 * The agent loop as an async generator of standardized events.
 * REPL, TUI and non-interactive runners all consume the same stream.
 */
export async function* runAgent(opts: AgentOptions): AsyncGenerator<AgentEvent> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxBytes = opts.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES;
  const stats = emptyStats();

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (opts.signal?.aborted) {
      yield* finishAborted(opts);
      return;
    }
    stats.turns = turn;
    yield { type: 'turn_start', turn };

    const messageId = newId('msg');
    let content = '';
    let finishReason: string | undefined;
    let usage: Usage | undefined;
    const partialCalls = new Map<number, { id?: string; name?: string; args: string }>();

    let request: ChatRequest = {
      messages: opts.messages,
      systemPrompt: opts.systemPrompt,
      tools: opts.tools,
      signal: opts.signal,
    };
    if (opts.hooks?.beforeLLMCall) request = await opts.hooks.beforeLLMCall(request);
    const stream = opts.provider.stream(request);
    // Cumulative stats as of the start of the in-flight attempt: a provider
    // reset rolls the running stats back to this snapshot, discarding usage
    // reported by the failed attempt.
    let attemptStats: UsageStats = { ...stats };

    // An abort surfaces either as the signal firing between events or as an
    // AbortError thrown by the provider; both end the run the same way.
    let interrupted = false;
    try {
      for await (const ev of stream) {
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
      // Once the user asked to stop, unwind as an interruption regardless of
      // which error the abort raced with.
      if (!opts.signal?.aborted) throw err;
      interrupted = true;
    }
    if (interrupted) {
      yield* finishAborted(opts);
      return;
    }

    const toolCalls: ToolCall[] = [...partialCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, partial]) => ({
        id: partial.id ?? newId('call'),
        name: partial.name ?? 'unknown',
        args: parseArgs(partial.args),
        rawArgs: partial.args,
      }));

    const assistant: AssistantMessage = {
      id: messageId,
      ts: Date.now(),
      role: 'assistant',
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(usage ? { usage } : {}),
      ...(finishReason !== undefined ? { finishReason } : {}),
    };
    opts.messages.push(assistant);
    yield { type: 'message', message: assistant };

    if (toolCalls.length === 0) {
      yield { type: 'done', stopReason: 'complete' };
      return;
    }

    // A "length" stop means the output was cut off by the token limit, so
    // every tool call in the batch may carry silently-truncated arguments.
    // Fail them all (the loop continues, so the model can re-issue them).
    if (finishReason === 'length') {
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

    const toolByName = new Map((opts.tools ?? []).map((tool) => [tool.name, tool]));
    yield* runToolCalls(toolCalls, toolByName, turn, opts, maxBytes);
  }

  yield { type: 'done', stopReason: 'max_turns' };
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
        const result = await completeToolCall(verdict.effective, opts, maxBytes, toolByName);
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
    const pending = approved.map((entry) => completeToolCall(entry.effective, opts, maxBytes, toolByName));
    for (let i = 0; i < pending.length; i++) {
      const result = await pending[i]!;
      opts.messages.push(result);
      yield { type: 'tool_call_result', turn, call: approved[i]!.effective, result };
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

function parseArgs(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function executeTool(
  tool: ToolDefinition | undefined,
  call: ToolCall,
  opts: AgentOptions,
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
      });
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();

  if (tool.timeoutMs === undefined) return run;

  // Cooperative timeout: abort the merged signal and stop waiting. In-process
  // code that ignores the signal keeps running — the loop never hard-kills it.
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      timeoutController?.abort();
      resolve(`Error: tool "${call.name}" timed out after ${tool.timeoutMs}ms (cancellation was requested; work that ignores the signal may still be running)`);
    }, tool.timeoutMs);
    void run.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/** Execute one approved call and produce its log-ready result message. */
async function completeToolCall(
  call: ToolCall,
  opts: AgentOptions,
  maxBytes: number,
  toolByName: Map<string, ToolDefinition>,
): Promise<ToolResultMessage> {
  let rawResult = await executeTool(toolByName.get(call.name), call, opts);
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
  const cacheDir = opts.cacheDir ?? path.join(opts.rootDir, '.nova', 'cache', 'tool-outputs');
  await mkdir(cacheDir, { recursive: true });
  const ref = path.join(cacheDir, `${newId('out')}.txt`);
  // 'wx' refuses to overwrite (or follow a planted symlink at) an existing path.
  await writeFile(ref, raw, { encoding: 'utf8', flag: 'wx' });
  const dropped = Buffer.byteLength(raw, 'utf8') - maxBytes;
  const headLen = Math.floor(maxBytes * HEAD_TAIL_RATIO);
  const head = truncateBytes(raw, headLen);
  const tail = truncateTailBytes(raw, maxBytes - headLen);
  const content = `${head}\n[truncated ${dropped} chars; full output at ${ref} — use the read tool on this path to view it]\n${tail}`;
  return { content, truncatedRef: ref };
}

/** Share of the byte budget kept as the head; the rest keeps the tail. */
const HEAD_TAIL_RATIO = 0.6;

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
