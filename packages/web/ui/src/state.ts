/**
 * The transcript reducer (M11 批2/批3): frames in, UI state out — pure
 * function, no React, no timers. This is the browser's only reducer; every
 * component below is a projection of its state.
 *
 * Two contracts it lives by:
 *  - **The durable log is the truth.** A (re)`ready` frame REPLACES the
 *    transcript with the host's projection of the log; sockets are disposable.
 *    Note what is NOT here: no message parsing, no per-tool knowledge — the
 *    host resolves render intent (`view`/`resultView`) and ships blocks.
 *  - **Views come from the vocabulary.** Tool rows render `switch (view.card)`;
 *    a card this bundle has never seen still renders from its own fields,
 *    because `generic` is always available as the fallback.
 */
import type {
  ApprovalMode, ApprovalRequest, JobSnapshot, KernelEvent, PtcMode, ReadyInfo, RunStats, SessionListItem, ToolCallView, ToolResultView, TurnPhase, WireBlock,
} from './types.js';

export type Block =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'text'; text: string; streaming: boolean }
  | { id: string; kind: 'reasoning'; text: string; streaming: boolean }
  | {
      id: string;
      kind: 'tool';
      callId: string;
      name: string;
      args: string;
      view: ToolCallView;
      /** When the call started (the transcript's clock; log ts on replay). */
      ts?: number;
      /** Absent until the call reports — the row renders as in-flight. */
      result?: ToolResultView;
      /** The result text, for the detail panel. */
      output?: string;
      /** Live tail line while the call runs (bash output etc.). */
      tail?: string;
    }
  | { id: string; kind: 'hint'; text: string; tone: 'info' | 'warn' }
  /** A finished run's numbers, rendered as the turn's meta row. */
  | { id: string; kind: 'meta'; stats: RunStats }
  /** One background job, updated in place by id for the life of the job. */
  | { id: string; kind: 'job'; job: JobSnapshot };

/** Session-cumulative numbers (the stats bar). Sums of the `run_stats` stream. */
export interface SessionTotals {
  runs: number;
  requests: number;
  toolCalls: number;
  retries: number;
  llmMs: number;
  toolMs: number;
  /** Summed over runs that reported a first token — the average's numerator. */
  firstTokenMs: number;
  firstTokenRuns: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export const emptyTotals: SessionTotals = {
  runs: 0,
  requests: 0,
  toolCalls: 0,
  retries: 0,
  llmMs: 0,
  toolMs: 0,
  firstTokenMs: 0,
  firstTokenRuns: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
};

export interface UiState {
  connected: boolean;
  meta: ReadyInfo | null;
  approvalMode: ApprovalMode;
  codeMode: PtcMode;
  blocks: Block[];
  phase: TurnPhase | 'disconnected';
  pendingApproval: ApprovalRequest | null;
  queued: readonly string[];
  turnCount: number;
  /** Prompt tokens of the last request (the context gauge's numerator). */
  usedTokens: number;
  contextWindow: number | null;
  /** Session switcher contents; null = not fetched (panel closed). */
  sessions: readonly SessionListItem[] | null;
  /** Baseline blocks the browser holds (from `ready` plus `load_earlier`). */
  historyLoaded: number;
  /** Blocks the baseline has in all — anything above `historyLoaded` is older. */
  historyTotal: number;
  /** Cumulative run numbers for the stats bar (session-scoped, like the kernel's). */
  totals: SessionTotals;
}

export const initialState: UiState = {
  connected: false,
  meta: null,
  approvalMode: 'read-only',
  codeMode: 'native',
  blocks: [],
  phase: 'idle',
  pendingApproval: null,
  queued: [],
  turnCount: 0,
  usedTokens: 0,
  contextWindow: null,
  sessions: null,
  historyLoaded: 0,
  historyTotal: 0,
  totals: emptyTotals,
};

let blockSeq = 0;
const nextId = (): string => `b${(blockSeq += 1)}`;

export type Action =
  | { type: 'connection'; connected: boolean }
  | { type: 'ready'; info: ReadyInfo }
  | { type: 'event'; event: KernelEvent; view?: ToolCallView; resultView?: ToolResultView }
  | { type: 'state'; approvalMode: ApprovalMode; codeMode: PtcMode }
  | { type: 'sessions'; items: readonly SessionListItem[] }
  | { type: 'history_earlier'; blocks: readonly WireBlock[]; total: number }
  | { type: 'error'; message: string };

export function reduce(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'connection':
      return {
        ...state,
        connected: action.connected,
        // 'disconnected' is synthetic (not a kernel TurnPhase): a reconnect must
        // clear it, or the badge outlives the disconnect until the next event.
        phase: action.connected ? (state.phase === 'disconnected' ? 'idle' : state.phase) : 'disconnected',
      };
    case 'ready':
      return {
        ...state,
        connected: true,
        meta: action.info,
        approvalMode: action.info.approvalMode,
        codeMode: action.info.codeMode,
        phase: 'idle',
        pendingApproval: action.info.pendingApprovals[0] ?? null,
        queued: [],
        // A session switch re-baselines everything session-scoped; the session
        // list is cleared so the panel refetches against the new transcript.
        sessions: null,
        usedTokens: action.info.usedTokens,
        contextWindow: action.info.contextWindow ?? null,
        blocks: action.info.history.map(replayBlock),
        historyLoaded: action.info.history.length,
        historyTotal: action.info.historyTotal,
        // Totals count runs the kernel measured in THIS process; a resume does
        // not inherit the old process's numbers (nor invent any).
        totals: emptyTotals,
      };
    case 'event':
      return reduceEvent(state, action.event, action.view, action.resultView);
    case 'state':
      return { ...state, approvalMode: action.approvalMode, codeMode: action.codeMode };
    case 'sessions':
      return { ...state, sessions: action.items };
    case 'history_earlier':
      // Older blocks go in FRONT; the cursor is what the browser now holds.
      return {
        ...state,
        blocks: [...action.blocks.map(replayBlock), ...state.blocks],
        historyLoaded: state.historyLoaded + action.blocks.length,
        historyTotal: action.total,
      };
    case 'error':
      return hint(state, `宿主提示：${action.message}`, 'warn');
  }
}

/** One replayed log entry → one block (the host already did the interpretation). */
function replayBlock(entry: WireBlock): Block {
  if (entry.kind === 'tool') {
    return {
      id: nextId(),
      kind: 'tool',
      callId: entry.callId,
      name: entry.name,
      args: entry.args,
      view: entry.view,
      ...(entry.ts !== undefined ? { ts: entry.ts } : {}),
      ...(entry.result !== undefined ? { result: entry.result } : {}),
      ...(entry.output !== undefined ? { output: entry.output } : {}),
    };
  }
  return entry.kind === 'user'
    ? { id: nextId(), kind: 'user', text: entry.text }
    : { id: nextId(), kind: 'text', text: entry.text, streaming: false };
}

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
      | 'llm_retry'
      | 'empty_completion'
      | 'done';
  }
>;

/** Events that only touch run state (phase, approvals, queue, notices, usage, totals). */
type RunStateEvent = Extract<
  KernelEvent,
  {
    type:
      | 'turn_start'
      | 'phase'
      | 'approval_request'
      | 'approval_resolved'
      | 'queue_update'
      | 'compaction'
      | 'notice'
      | 'run_failed'
      | 'usage'
      | 'run_stats';
  }
>;

function reduceEvent(
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
    case 'llm_retry':
    case 'empty_completion':
    case 'done':
      return true;
    default:
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
      return appendBlock(state, { id: nextId(), kind: 'user', text: event.message.content });
    case 'text_delta':
      return streamBlock(state, 'text', event.text);
    case 'reasoning_delta':
      return streamBlock(state, 'reasoning', event.text);
    case 'tool_call_start':
      return appendBlock(state, {
        id: nextId(),
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
      return { ...state, blocks: mapTool(state, undefined, (b) => (b.result === undefined ? { ...b, tail } : b)) };
    }
    case 'job_update':
      return upsertJob(state, event.job);
    case 'llm_retry':
      // The in-flight answer is being re-requested: say so in the transcript,
      // where the gap in the output otherwise looks like a stall.
      return hint(state, `已重新请求模型（${event.attempt}/${event.maxRetries}）· ${event.error}`, 'warn');
    case 'empty_completion':
      return hint(state, `空补全（${event.finishReason}），正在重发同一请求（${event.attempt}/${event.maxRetries}）`, 'warn');
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
      return state.pendingApproval?.id === event.id ? { ...state, pendingApproval: null } : state;
    case 'queue_update':
      return { ...state, queued: event.items };
    case 'compaction':
      if (event.progress.state === 'start') return hint(state, '上下文压缩中…', 'info');
      if (event.progress.state === 'done') return hint(state, `已自动压缩 — 保留 ${event.progress.retained ?? 0} 条最近消息`, 'info');
      return state; // error rides the notice channel
    case 'notice':
      return hint(state, event.text, event.code === 'compact_fused' ? 'warn' : 'info');
    case 'run_failed': {
      // The turn is over either way: a still-open stream would leave the typing
      // cursor blinking on partial text that will never grow.
      const settled = { ...state, blocks: closeStreaming(state.blocks) };
      return hint(settled, event.aborted ? '已中断' : `出错：${event.message}`, 'warn');
    }
    case 'run_stats':
      // Two records of the same numbers: the turn's own meta row (where it
      // happened) and the running session totals (the stats bar).
      return {
        ...state,
        blocks: [...state.blocks, { id: nextId(), kind: 'meta', stats: event.stats }],
        totals: addRun(state.totals, event.stats),
      };
  }
}

/** Close whatever stream is open, then append — a new block ends the previous one. */
function appendBlock(state: UiState, block: Block): UiState {
  return { ...state, blocks: [...closeStreaming(state.blocks), block] };
}

/** Append a delta to the open stream of the same kind, else open a new one. */
function streamBlock(state: UiState, kind: 'text' | 'reasoning', text: string): UiState {
  const last = state.blocks.at(-1);
  if (last?.kind === kind && last.streaming) {
    return { ...state, blocks: replaceLast(state.blocks, { ...last, text: last.text + text }) };
  }
  return appendBlock(state, { id: nextId(), kind, text, streaming: true });
}

/** Rewrite tool rows by call id (all unfinished rows when the id is unknown). */
function mapTool(state: UiState, callId: string | undefined, fn: (block: Extract<Block, { kind: 'tool' }>) => Block): Block[] {
  return state.blocks.map((b) => (b.kind === 'tool' && (callId === undefined || b.callId === callId) ? fn(b) : b));
}

function markToolResult(state: UiState, callId: string, result: ToolResultView | undefined, output: string): UiState {
  return {
    ...state,
    blocks: mapTool(state, callId, (b) => ({
      ...b,
      // Without a view from the host the row keeps its call card and stays
      // in-flight rather than inventing a verdict from the raw text.
      result: result ?? b.result,
      output,
    })),
  };
}

/**
 * Background jobs live as ONE transcript row each, injected where they started
 * and rewritten in place as they progress — the same "one place, later updates
 * replace the first" rule the terminal's live rows follow. A job that outlives
 * its run stays visible until it settles.
 */
function upsertJob(state: UiState, job: JobSnapshot): UiState {
  const id = `job:${job.id}`;
  const block: Block = { id, kind: 'job', job };
  const at = state.blocks.findIndex((b) => b.id === id);
  if (at < 0) return { ...state, blocks: [...state.blocks, block] };
  const blocks = [...state.blocks];
  blocks[at] = block;
  return { ...state, blocks };
}

function addRun(totals: SessionTotals, stats: RunStats): SessionTotals {
  return {
    runs: totals.runs + 1,
    requests: totals.requests + stats.requests,
    toolCalls: totals.toolCalls + stats.toolCalls,
    retries: totals.retries + stats.retries,
    llmMs: totals.llmMs + stats.llmMs,
    toolMs: totals.toolMs + stats.toolMs,
    firstTokenMs: totals.firstTokenMs + (stats.firstTokenMs ?? 0),
    firstTokenRuns: totals.firstTokenRuns + (stats.firstTokenMs === undefined ? 0 : 1),
    promptTokens: totals.promptTokens + stats.promptTokens,
    completionTokens: totals.completionTokens + stats.completionTokens,
    cachedTokens: totals.cachedTokens + stats.cachedTokens,
  };
}

function hint(state: UiState, text: string, tone: 'info' | 'warn'): UiState {
  return { ...state, blocks: [...state.blocks, { id: nextId(), kind: 'hint', text, tone }] };
}

function closeStreaming(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.kind === 'text' || b.kind === 'reasoning' ? (b.streaming ? { ...b, streaming: false } : b) : b));
}

function replaceLast(blocks: Block[], block: Block): Block[] {
  return [...blocks.slice(0, -1), block];
}

function lastLine(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('\n') + 1);
}