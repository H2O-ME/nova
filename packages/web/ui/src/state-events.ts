/**
 * Kernel event → transcript + run state. The reducer's second half: `state.ts`
 * owns the frame-level bookkeeping (attach, sessions, pagination) and the
 * exported types; this module owns one case per kernel event.
 *
 * The rule every case follows: an event either appends a row, rewrites the ONE
 * row it belongs to, or says something in a hint. A channel the kernel
 * publishes that no case here draws is a feature the user cannot see — which is
 * why the switch covers the whole protocol rather than the subset the first
 * version happened to need.
 */
import type { KernelEvent, SubagentProgress, ToolCallView, ToolResultView } from './types.js';
import type { Block, Draft, SubRow, UiState } from './state.js';
import { addRun } from '../../src/totals';

/** A notice code without an entry below still renders (its `text` is the fallback). */
type NoticeCode = Extract<KernelEvent, { type: 'notice' }>['code'];

/**
 * The notice channel's labels. The kernel ships a stable `code` plus a
 * renderable `text`; the code decides the tone and the one-word label (which
 * notices are operational failures is a kernel fact, not a styling choice) and
 * the text stays the body. Exhaustive on purpose: a new code in core forces a
 * decision here instead of sliding through as "info".
 */
export const NOTICE_LABELS: Record<NoticeCode, { label: string; tone: 'info' | 'warn' }> = {
  compacted: { label: '压缩', tone: 'info' },
  compact_fused: { label: '压缩熔断', tone: 'warn' },
  compact_alias_broken: { label: '压缩停用', tone: 'warn' },
  compact_failed: { label: '压缩失败', tone: 'warn' },
  surface_lagged: { label: '界面滞后', tone: 'warn' },
  listener_failed: { label: '监听异常', tone: 'warn' },
};

/** Events that only touch the transcript (block list). */
type TranscriptEvent = Extract<
  KernelEvent,
  {
    type:
      | 'user_message'
      | 'text_delta'
      | 'reasoning_delta'
      | 'tool_call_start'
      | 'tool_call_result'
      | 'tool_progress'
      | 'job_update'
      | 'subagent_update'
      | 'llm_retry'
      | 'empty_completion'
      | 'command'
      | 'done';
  }
>;

/** Events that only touch run state (phase, approvals, queue, model, notices, usage, totals). */
type RunStateEvent = Extract<
  KernelEvent,
  {
    type:
      | 'turn_start'
      | 'phase'
      | 'approval_request'
      | 'approval_resolved'
      | 'queue_update'
      | 'model'
      | 'compaction'
      | 'notice'
      | 'run_failed'
      | 'usage'
      | 'run_stats';
  }
>;

export function reduceEvent(
  state: UiState,
  event: KernelEvent,
  view: ToolCallView | undefined,
  resultView: ToolResultView | undefined,
): UiState {
  if (isTranscriptEvent(event)) return reduceTranscript(state, event, view, resultView);
  if (isRunStateEvent(event)) return reduceRunState(state, event);
  return state;
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
      // `turn_aborted` lands here: the kernel's marker message is model-facing
      // scaffolding, and the "已中断" line the user reads comes from
      // `run_failed` with `aborted: true`.
      return false;
  }
}

function isRunStateEvent(event: KernelEvent): event is RunStateEvent {
  switch (event.type) {
    case 'turn_start':
    case 'phase':
    case 'approval_request':
    case 'approval_resolved':
    case 'queue_update':
    case 'model':
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

function reduceTranscript(
  state: UiState,
  event: TranscriptEvent,
  view: ToolCallView | undefined,
  resultView: ToolResultView | undefined,
): UiState {
  switch (event.type) {
    case 'user_message':
      // The message's own timestamp: the row's clock reads the same here as it
      // does on replay (the log carries it, so neither path invents one).
      return push(state, { kind: 'user', text: event.message.content, ts: event.message.ts });
    case 'text_delta':
      return streamBlock(state, 'text', event.text);
    case 'reasoning_delta':
      return streamBlock(state, 'reasoning', event.text);
    case 'tool_call_start':
      return push(state, {
        kind: 'tool',
        callId: event.call.id,
        name: event.call.name,
        args: event.call.rawArgs,
        ts: Date.now(),
        // The host resolves this from the LIVE tool registry; a client that
        // somehow got no view still renders (generic card from name+args).
        view: view ?? { card: 'generic', kind: 'other', title: event.call.name },
      });
    case 'tool_call_result':
      return markToolResult(state, event.call.id, resultView, event.result.content);
    case 'tool_progress': {
      const tail = lastLine(event.text);
      if (tail.length === 0) return state;
      return { ...state, blocks: mapTool(state.blocks, event.callId, (b) => (b.result === undefined ? { ...b, tail } : b)) };
    }
    case 'job_update':
      return upsertRow(state, `job:${event.job.id}`, (id) => ({ id, kind: 'job', job: event.job }));
    case 'subagent_update':
      return reduceSubagent(state, event.progress);
    case 'llm_retry': {
      // The failed attempt's partial output is DISCARDED, not kept (core's
      // `llm_retry` contract): the loop re-issues the same request, so leftover
      // text would have the retry's deltas appended to it.
      const dropped = dropPartial(state);
      return hint(dropped, `请求失败，已丢弃半截输出并重试（${event.attempt}/${event.maxRetries}）· ${event.error}`, 'warn');
    }
    case 'empty_completion':
      return hint(state, `空补全（${event.finishReason}），正在重发同一请求（${event.attempt}/${event.maxRetries}）`, 'warn');
    case 'command':
      return reduceCommand(state, event);
    case 'done':
      return { ...state, blocks: closeStreaming(state.blocks) };
  }
}

function reduceRunState(state: UiState, event: RunStateEvent): UiState {
  switch (event.type) {
    case 'turn_start':
      return { ...state, turnCount: state.turnCount + 1 };
    case 'phase':
      return { ...state, phase: event.phase };
    case 'usage':
      // The gauge's numerator is CONSUMPTION (prompt tokens of the last
      // request), not the cumulative session total.
      return { ...state, usedTokens: event.usage.promptTokens };
    case 'approval_request':
      return { ...state, pendingApproval: event.request };
    case 'approval_resolved':
      return resolveApproval(state, event.id, event.resolution);
    case 'queue_update':
      return { ...state, queued: event.items };
    case 'model':
      // A switch is a session-level fact, so the event (not the picker's own
      // optimism) is what moves the label: a pick the endpoint refuses leaves
      // the seat showing the model actually in force.
      return {
        ...state,
        model: event.model,
        // An unreported name or window CLEARS rather than keeping the previous
        // model's: a stale label or denominator would describe a model that is
        // no longer in force.
        modelName: event.name ?? null,
        contextWindow: event.contextWindow ?? null,
      };
    case 'compaction': {
      const { state: step, trigger, retained, error } = event.progress;
      const how = trigger === 'manual' ? '手动' : '自动';
      if (step === 'start') return hint(state, `上下文压缩中（${how}）…`, 'info');
      if (step === 'done') return hint(state, `${how}压缩完成 — 保留最近 ${retained ?? 0} 条消息`, 'info');
      return hint(state, `${how}压缩失败：${error ?? '未知原因'}`, 'warn');
    }
    case 'notice': {
      const meta = NOTICE_LABELS[event.code] as { label: string; tone: 'info' | 'warn' } | undefined;
      return meta === undefined ? hint(state, event.text, 'info') : hint(state, `${meta.label} · ${event.text}`, meta.tone);
    }
    case 'run_failed': {
      // The turn is over either way: a still-open stream would leave the typing
      // cursor blinking on partial text that will never grow.
      const settled = { ...state, blocks: closeStreaming(state.blocks) };
      return hint(settled, event.aborted ? '已中断' : `出错：${event.message}`, 'warn');
    }
    case 'run_stats':
      // Two records of the same numbers: the turn's own meta row (where it
      // happened) and the running session totals (the stats bar).
      return { ...push(state, { kind: 'meta', stats: event.stats }), totals: addRun(state.totals, event.stats) };
  }
}

/**
 * A vanished dialog must say why. When the USER answered, the tool row carries
 * the verdict and a hint would be noise; when the kernel closed the ask itself
 * (abort, session close) the fail-closed denial is invisible otherwise — the
 * tool result is synthesized inside the loop and the call never runs.
 */
function resolveApproval(state: UiState, id: string, resolution: { source: 'user' | 'aborted' | 'closed' }): UiState {
  const wasOpen = state.pendingApproval?.id === id;
  const cleared = wasOpen ? { ...state, pendingApproval: null } : state;
  if (!wasOpen || resolution.source === 'user') return cleared;
  const cause = resolution.source === 'aborted' ? '本轮中断' : '会话关闭';
  return hint(cleared, `${cause}，未回答的审批按拒绝处理`, 'warn');
}

/**
 * Nested-subagent life as ONE row per label, rewritten in place (the same
 * "one place, later updates replace the first" rule the job rows follow).
 * `usage` frames are deliberately not drawn: the row shows the nested loop's
 * SHAPE while it runs (how many calls it has made, what it is calling) and its
 * totals once `done` lands, so no per-request accumulation is invented here.
 */
function reduceSubagent(state: UiState, progress: SubagentProgress): UiState {
  const id = `sub:${progress.label}`;
  const at = state.blocks.findIndex((b) => b.id === id);
  const prior = at < 0 ? undefined : state.blocks[at];
  const prev = prior?.kind === 'sub' ? prior.sub : undefined;
  const running: SubRow = { label: progress.label, status: 'running', calls: prev?.calls ?? 0 };
  switch (progress.type) {
    case 'start':
      return upsertRow(state, id, () => ({ id, kind: 'sub', sub: running }));
    case 'tool_call':
      return upsertRow(state, id, () => ({
        id,
        kind: 'sub',
        sub: { ...running, calls: running.calls + 1, detail: callLine(progress.call) },
      }));
    case 'done':
      return upsertRow(state, id, () => ({
        id,
        kind: 'sub',
        sub: { ...running, status: progress.status, calls: progress.usage.toolCalls, usage: progress.usage },
      }));
    case 'usage':
      return state;
  }
}

/** `read_file {"path": "a.ts"}` → `read_file {"path": "a.ts"}` one-line (no dumps). */
function callLine(call: { name: string; rawArgs: string }): string {
  const args = call.rawArgs.replace(/\s+/g, ' ').trim();
  return args.length === 0 ? call.name : `${call.name} ${args}`;
}

/** Append a delta to the open stream of the same kind, else open a new one. */
function streamBlock(state: UiState, kind: 'text' | 'reasoning', text: string): UiState {
  const last = state.blocks.at(-1);
  if (last?.kind === kind && last.streaming) {
    return { ...state, blocks: [...state.blocks.slice(0, -1), { ...last, text: last.text + text }] };
  }
  // A streamed block is stamped when it opens: the live path has no log yet,
  // and the tail's clock must not jump to the close time of a long turn.
  return push(state, { kind, text, streaming: true, ts: Date.now() });
}

/** Drop the failed attempt's trailing partial output (llm_retry). */
function dropPartial(state: UiState): UiState {
  let end = state.blocks.length;
  while (end > 0) {
    const block = state.blocks[end - 1];
    if (block === undefined || (block.kind !== 'text' && block.kind !== 'reasoning') || !block.streaming) break;
    end -= 1;
  }
  return end === state.blocks.length ? state : { ...state, blocks: state.blocks.slice(0, end) };
}

/**
 * Rewrite tool rows in place. An explicit id names its row; `undefined` is the
 * progress channel's "whatever is running" (the kernel publishes the call id it
 * last saw start, which is unknown while a nested dispatch streams), so it
 * resolves to the LAST unfinished row — never to all of them, which would smear
 * one tool's output across every open call in the transcript.
 */
function mapTool(blocks: Block[], callId: string | undefined, fn: (block: Extract<Block, { kind: 'tool' }>) => Block): Block[] {
  const at = callId === undefined ? lastUnfinishedTool(blocks) : blocks.findIndex((b) => b.kind === 'tool' && b.callId === callId);
  const target = at < 0 ? undefined : blocks[at];
  if (target === undefined || target.kind !== 'tool') return blocks;
  const next = [...blocks];
  next[at] = fn(target);
  return next;
}

function lastUnfinishedTool(blocks: readonly Block[]): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block !== undefined && block.kind === 'tool' && block.result === undefined) return i;
  }
  return -1;
}

function markToolResult(state: UiState, callId: string, result: ToolResultView | undefined, output: string): UiState {
  return {
    ...state,
    blocks: mapTool(state.blocks, callId, (b) => ({
      ...b,
      // Without a view from the host the row keeps its call card and stays
      // in-flight rather than inventing a verdict from the raw text.
      result: result ?? b.result,
      output,
    })),
  };
}

/**
 * One row, rewritten in place by id (jobs and nested subagents both live this
 * way): injected where it first appeared, updated wherever it goes from there.
 * A row that outlives its run stays visible until it settles.
 */
function upsertRow(state: UiState, id: string, make: (id: string) => Block): UiState {
  const at = state.blocks.findIndex((b) => b.id === id);
  if (at < 0) return { ...state, blocks: [...state.blocks, make(id)] };
  const blocks = [...state.blocks];
  blocks[at] = make(id);
  return { ...state, blocks };
}

/**
 * One slash command's two events → one transcript row, closed in place.
 *
 * `run` appends, `done` closes the NEWEST row of that name rather than a fixed
 * id: running the same command twice is two lines, each where it happened (the
 * reader's question is "what did I do, in what order"), a `done` with no `run`
 * before it — a name the registry does not know — still leaves a line instead of
 * failing silently, and a repeated `done` settles the line already on screen
 * instead of stacking an empty one under it.
 */
function reduceCommand(state: UiState, event: Extract<KernelEvent, { type: 'command' }>): UiState {
  if (event.phase === 'run') return push(state, { kind: 'command', name: event.name, running: true });
  const done: Draft = {
    kind: 'command',
    name: event.name,
    running: false,
    ...(event.text !== undefined ? { text: event.text } : {}),
  };
  let at = -1;
  for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
    const block = state.blocks[index];
    if (block?.kind === 'command' && block.name === event.name) { at = index; break; }
  }
  if (at < 0) return push(state, done);
  const open = state.blocks[at];
  if (open === undefined || open.kind !== 'command') return push(state, done);
  // The closing row KEEPS what the opening one carried when the new event says
  // nothing — a bare `done` must not blank the text already on screen.
  const text = event.text ?? open.text;
  const closed: Block = {
    id: open.id,
    kind: 'command',
    name: open.name,
    running: false,
    ...(text !== undefined ? { text } : {}),
  };
  return { ...state, blocks: state.blocks.map((block, index) => (index === at ? closed : block)) };
}

/** Append a freshly minted block (ids come from the state's counter — see `push`). */
function push(state: UiState, block: Draft): UiState {
  return mint({ ...state, blocks: closeStreaming(state.blocks) }, block);
}

function hint(state: UiState, text: string, tone: 'info' | 'warn'): UiState {
  return mint(state, { kind: 'hint', text, tone });
}

function mint(state: UiState, block: Draft): UiState {
  const seq = state.seq + 1;
  return { ...state, seq, blocks: [...state.blocks, { ...block, id: `b${seq}` } as Block] };
}

function closeStreaming(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.kind === 'text' || b.kind === 'reasoning' ? (b.streaming ? { ...b, streaming: false } : b) : b));
}

function lastLine(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('\n') + 1);
}
