/**
 * The transcript model and its reducer (M11 批4).
 *
 * One reducer, pure, driven by the kernel event stream — the same shape as the
 * web surface's, with the fields a terminal needs and a browser does not:
 * per-call timings (a tool row shows how long it took), the running turn's
 * start (the live row's timer), and live rows for nested subagents and
 * background jobs.
 *
 * The surface resolves the presentation *views* itself, from the live tool
 * registry — `callViewOf` / `resultViewOf` are core's, so both surfaces answer
 * "what is this call" identically without a wire in between.
 */
import {
  callViewOf,
  isFailureContent,
  resultViewOf,
  type ApprovalRequest,
  type JobSnapshot,
  type KernelEvent,
  type SubagentProgress,
  type ToolCall,
  type ToolCallView,
  type ToolResultView,
  type ToolViewSource,
  type TurnPhase,
} from '@nova-agent/core';

export type Block =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'text'; text: string; streaming: boolean }
  | { id: string; kind: 'reasoning'; text: string; streaming: boolean }
  | {
      id: string;
      kind: 'tool';
      callId: string;
      name: string;
      /** Flattened argument preview (the card may override it). */
      args: string;
      view: ToolCallView;
      result?: ToolResultView;
      /** Live tail line while the call runs (bash output). */
      tail?: string;
      startedAt: number;
      endedAt?: number;
      /** Expanded by the user (three-state fold); dense runs only fold collapsed rows. */
      expanded: boolean;
      failed: boolean;
    }
  /** One line of system chatter: notices, retries, subagent and job lives. */
  | { id: string; kind: 'hint'; text: string; tone: 'info' | 'warn' | 'live' };

export interface TranscriptState {
  blocks: Block[];
  phase: TurnPhase | 'disconnected';
  pending: ApprovalRequest | null;
  queued: readonly string[];
  /** When the current turn began (drives the live row); undefined while idle. */
  turnStartedAt: number | undefined;
  turnCount: number;
  /** Prompt tokens of the last request (the live row's `⇣Nk`). */
  promptTokens: number;
  /** Last turn's elapsed ms, for the post-turn status line. */
  lastTurnMs: number | undefined;
}

export interface ReduceContext {
  /** Live tool registry: the model is resolved from the same source as anywhere. */
  tools: () => readonly ToolViewSource[];
  now: number;
}

export const initialTranscript: TranscriptState = {
  blocks: [],
  phase: 'idle',
  pending: null,
  queued: [],
  turnStartedAt: undefined,
  turnCount: 0,
  promptTokens: 0,
  lastTurnMs: undefined,
};

let seq = 0;
const nextId = (prefix: string): string => `${prefix}${(seq += 1)}`;

export function reduce(state: TranscriptState, event: KernelEvent, ctx: ReduceContext): TranscriptState {
  switch (event.type) {
    case 'turn_start':
      return { ...state, turnCount: state.turnCount + 1, turnStartedAt: state.turnStartedAt ?? ctx.now, phase: 'thinking' };
    case 'user_message':
      return append(state, { id: nextId('u'), kind: 'user', text: event.message.content });
    case 'text_delta':
      return stream(state, 'text', event.text);
    case 'reasoning_delta':
      return stream(state, 'reasoning', event.text);
    case 'tool_call_start':
      return append(state, startTool(event.call, ctx));
    case 'tool_call_result':
      return withTool(state, event.call.id, (block) => ({
        ...block,
        result: resultViewOf(ctx.tools(), event.call, event.result.content),
        endedAt: ctx.now,
        failed: isFailureContent(event.result.content),
      }));
    case 'tool_progress':
      return { ...state, blocks: state.blocks.map((b) => (b.kind === 'tool' && b.result === undefined ? { ...b, tail: lastLine(event.text) } : b)) };
    case 'message':
      return { ...state, blocks: closeStreaming(state.blocks) };
    case 'done':
      return endTurn(state, ctx);
    case 'phase':
      return state.phase === event.phase ? state : { ...state, phase: event.phase };
    case 'usage':
      return { ...state, promptTokens: event.usage.promptTokens };
    case 'approval_request':
      return { ...state, pending: event.request };
    case 'approval_resolved':
      return state.pending?.id === event.id ? { ...state, pending: null } : state;
    case 'queue_update':
      return { ...state, queued: event.items };
    case 'run_failed': {
      const settled: TranscriptState = { ...state, blocks: closeStreaming(state.blocks), turnStartedAt: undefined, phase: 'idle' };
      return append(settled, {
        id: nextId('h'),
        kind: 'hint',
        text: event.aborted ? '已中断' : `出错：${event.message}`,
        tone: 'warn',
      });
    }
    default:
      // Everything left is one line of system chatter (retries, compaction,
      // subagents, jobs, notices) or an event no terminal cares about.
      return chatter(state, event) ?? state;
  }
}

/** The turn is over: close the open stream, stop the live timer, record how long it took. */
function endTurn(state: TranscriptState, ctx: ReduceContext): TranscriptState {
  const elapsed = state.turnStartedAt === undefined ? undefined : ctx.now - state.turnStartedAt;
  return { ...state, blocks: closeStreaming(state.blocks), turnStartedAt: undefined, lastTurnMs: elapsed, phase: 'idle' };
}

/** One transient or live row, appended or updated in place. */
function chatter(state: TranscriptState, event: KernelEvent): TranscriptState | undefined {
  switch (event.type) {
    case 'llm_retry':
      return replaceLive(state, 'retry', `连接中断，正在重试（${event.attempt}/${event.maxRetries}）`, 'warn');
    case 'empty_completion':
      return replaceLive(state, 'empty', `空补全（${event.finishReason}），正在重新请求（${event.attempt}/${event.maxRetries}）`, 'warn');
    case 'compaction':
      return replaceLive(state, 'compact', compactLine(event.progress), event.progress.state === 'error' ? 'warn' : 'info');
    case 'notice':
      return append(state, { id: nextId('n'), kind: 'hint', text: event.text, tone: event.code === 'compact_fused' ? 'warn' : 'info' });
    case 'subagent_update':
      return replaceLive(state, `subagent:${event.progress.label}`, subagentLine(event.progress), subagentTone(event.progress));
    case 'job_update':
      return replaceLive(state, `job:${event.job.id}`, jobLine(event.job), event.job.status === 'failed' ? 'warn' : 'live');
    default:
      return undefined;
  }
}

function compactLine(progress: Extract<KernelEvent, { type: 'compaction' }>['progress']): string {
  if (progress.state === 'start') return '上下文压缩中…';
  if (progress.state === 'done') return `已压缩 — 保留 ${progress.retained ?? 0} 条最近消息`;
  return progress.error ?? '压缩失败';
}

/** A subagent that ended badly is worth the warning tone; everything else is a life. */
function subagentTone(progress: SubagentProgress): 'warn' | 'live' {
  return progress.type === 'done' && progress.status !== 'completed' ? 'warn' : 'live';
}

/** The tool block a call opens with, before any result arrives. */
function startTool(call: ToolCall, ctx: ReduceContext): Block {
  return {
    id: nextId('t'),
    kind: 'tool',
    callId: call.id,
    name: call.name,
    args: flattenArgs(call.rawArgs),
    view: callViewOf(ctx.tools(), call),
    startedAt: ctx.now,
    expanded: false,
    failed: false,
  };
}

/** Append a block, first closing any open stream (a new block ends the old one). */
function append(state: TranscriptState, block: Block): TranscriptState {
  return { ...state, blocks: [...closeStreaming(state.blocks), block] };
}

/** Append a delta to the stream of the same kind, or open a new one. */
function stream(state: TranscriptState, kind: 'text' | 'reasoning', text: string): TranscriptState {
  const last = state.blocks.at(-1);
  if (last?.kind === kind && last.streaming) {
    return { ...state, blocks: [...state.blocks.slice(0, -1), { ...last, text: last.text + text }] };
  }
  return append(state, { id: nextId(kind === 'text' ? 'a' : 'r'), kind, text, streaming: true });
}

/** Rewrite a tool block by call id; a missing block is a no-op, never a crash. */
function withTool(state: TranscriptState, callId: string, fn: (block: Extract<Block, { kind: 'tool' }>) => Block): TranscriptState {
  return { ...state, blocks: state.blocks.map((b) => (b.kind === 'tool' && b.callId === callId ? fn(b) : b)) };
}

/**
 * One line per live source, updated in place: a retry notice, a subagent, a
 * job. Ids are stable (`retry`, `subagent:<id>`) so the second update replaces
 * the first instead of stacking a wall of near-identical lines.
 */
function replaceLive(state: TranscriptState, key: string, text: string, tone: 'info' | 'warn' | 'live'): TranscriptState {
  const id = `live:${key}`;
  const index = state.blocks.findIndex((b) => b.id === id);
  const block: Block = { id, kind: 'hint', text, tone };
  if (index < 0) return append(state, block);
  return { ...state, blocks: state.blocks.map((b, i) => (i === index ? block : b)) };
}

function closeStreaming(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.kind === 'text' || b.kind === 'reasoning' ? (b.streaming ? { ...b, streaming: false } : b) : b));
}

function lastLine(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('\n') + 1);
}

function flattenArgs(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

function subagentLine(progress: SubagentProgress): string {
  const label = progress.label.slice(0, 120);
  if (progress.type === 'done') return `◈ 子代理 ${doneWord(progress.status)}：${label}`;
  if (progress.type === 'tool_call') return `◈ 子代理执行中：${label} · ${progress.call.name}`;
  return `◈ 子代理进行中：${label}`;
}

function jobLine(job: JobSnapshot): string {
  const detail = job.progress ?? job.detail ?? job.label;
  return `▤ 后台任务 ${job.id} ${jobWord(job.status)}：${detail.slice(0, 110)}`;
}

function doneWord(status: 'completed' | 'aborted' | 'ended'): string {
  return status === 'completed' ? '已完成' : status === 'aborted' ? '已中止' : '已结束';
}

function jobWord(status: JobSnapshot['status']): string {
  switch (status) {
    case 'running':
      return '进行中';
    case 'stopping':
      return '正在停止';
    case 'completed':
      return '已完成';
    case 'killed':
      return '已停止';
    case 'failed':
      return '失败';
  }
}