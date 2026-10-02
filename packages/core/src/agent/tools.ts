/**
 * 工具调度（M9.6 阶段 G 拆分）：分段并行、preflight 门、嵌套分发缝
 * （PTC dispatcher）、超时/中断宽限执行、结果落盘溢出。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newId } from '../ids.js';
import { errMessage } from '../errors.js';
import { toolOutputsDir } from '../paths.js';
import { truncateUtf8Head, truncateUtf8Tail } from '../utf8.js';
import { validateToolCallVerdict } from '../types.js';
import type {
  AgentEvent,
  ToolCall,
  ToolDefinition,
  ToolResultMessage,
} from '../types.js';
import {
  ABORT_GRACE_MS,
  SKIPPED_BY_ABORT,
  type AgentOptions,
  type ToolDispatcher,
} from './options.js';

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
export async function* runToolCalls(
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
        const reason = errMessage(outcome.reason);
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
    // Defense in depth: the composed host already validates, but AgentHooks
    // is a public interface — a hand-rolled implementation bypasses the host.
    // A malformed verdict fails closed (deny), never guessed into execution.
    const malformed = validateToolCallVerdict(verdict);
    if (malformed !== undefined) {
      return { kind: 'deny', content: `Permission denied: malformed hook verdict (${malformed})` };
    }
    if (verdict.action === 'deny') {
      const reason = verdict.reason !== undefined && verdict.reason.length > 0 ? `: ${verdict.reason}` : '';
      return { kind: 'deny', content: `Permission denied${reason}` };
    }
    // Trust seam: the rewrite lands AFTER the permission gate inside
    // beforeToolCall has already judged the ORIGINAL args — the rewritten
    // call is not re-gated (host.ts composes gate then hooks; no built-in
    // plugin rewrites today).
    if (verdict.action === 'rewrite') {
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
export function parseArgs(raw: string): { args: Record<string, unknown>; ok: boolean } {
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
export function makeDispatcher(opts: AgentOptions, toolByName: Map<string, ToolDefinition>): ToolDispatcher {
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
        ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
        ...(opts.emit !== undefined ? { emit: opts.emit } : {}),
        ...(opts.onToolProgress !== undefined ? { onProgress: opts.onToolProgress } : {}),
        ...(dispatch !== undefined ? { dispatch } : {}),
      });
    } catch (err) {
      return `Error: ${errMessage(err)}`;
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
  const tool = toolByName.get(call.name);
  // Tool-owned metadata is attached AFTER the afterToolResult hook and AFTER
  // truncation, so the meta describes the SETTLED result the surface renders,
  // not the in-flight string. The hook is pure and synchronous; absent or
  // undefined-returning tools add no field and the message ships unchanged.
  const meta = tool?.resultMeta?.(call.args, content);
  return {
    id: newId('msg'),
    ts: Date.now(),
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content,
    ...(truncatedRef ? { truncatedRef } : {}),
    ...(meta !== undefined ? { meta } : {}),
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
  const cacheDir = opts.cacheDir ?? toolOutputsDir();
  await mkdir(cacheDir, { recursive: true });
  const ref = path.join(cacheDir, `${newId('out')}.txt`);
  // 'wx' refuses to overwrite (or follow a planted symlink at) an existing path.
  await writeFile(ref, raw, { encoding: 'utf8', flag: 'wx' });
  // Keep the message body (head + hint line + tail) inside the byte budget:
  // reserve room for the hint line, then split the rest 60/40 head/tail.
  const bodyBudget = Math.max(1024, maxBytes - HINT_LINE_RESERVE_BYTES);
  const head = truncateUtf8Head(raw, Math.floor(bodyBudget * HEAD_TAIL_RATIO));
  const tail = truncateUtf8Tail(raw, bodyBudget - Math.floor(bodyBudget * HEAD_TAIL_RATIO));
  const dropped = Buffer.byteLength(raw, 'utf8') - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');
  const content = `${head}\n[truncated ${dropped} bytes; full output at ${ref} — use the read tool on this path to view it]\n${tail}`;
  return { content, truncatedRef: ref };
}

/** Share of the byte budget kept as the head; the rest keeps the tail. */
const HEAD_TAIL_RATIO = 0.6;
/** Room reserved for the truncation hint line so the body stays in budget. */
const HINT_LINE_RESERVE_BYTES = 200;
