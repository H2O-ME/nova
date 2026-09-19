/**
 * The transcript reducer (M11 批2): KernelEvent in, UI blocks out — pure
 * function, no React, no timers. This is the browser's only reducer; the
 * components below are projections of its state. Reconnect = a `ready` frame
 * REPLACES the transcript with the durable-log replay baseline (the same
 * contract the surfaces share: the log is the truth, sockets are disposable).
 */
import type { ApprovalRequest, KernelEvent, ReadyInfo, TurnPhase } from './types.js';

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
      state: 'running' | 'ok' | 'fail';
      tail?: string;
      detail?: string;
    }
  | { id: string; kind: 'hint'; text: string; tone: 'info' | 'warn' };

export interface UiState {
  connected: boolean;
  meta: ReadyInfo | null;
  blocks: Block[];
  phase: TurnPhase | 'disconnected';
  pendingApproval: ApprovalRequest | null;
  queued: readonly string[];
  turnCount: number;
}

export const initialState: UiState = {
  connected: false,
  meta: null,
  blocks: [],
  phase: 'idle',
  pendingApproval: null,
  queued: [],
  turnCount: 0,
};

let blockSeq = 0;
const nextId = (): string => `b${(blockSeq += 1)}`;

export type Action =
  | { type: 'connection'; connected: boolean }
  | { type: 'ready'; info: ReadyInfo }
  | { type: 'event'; event: KernelEvent }
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
        phase: 'idle',
        pendingApproval: action.info.pendingApprovals[0] ?? null,
        queued: [],
        blocks: replay(action.info),
      };
    case 'event':
      return reduceEvent(state, action.event);
    case 'error':
      return hint(state, `宿主提示：${action.message}`, 'warn');
  }
}

/** Rebuild the transcript from the projected log (2b scope: text surfaces only). */
function replay(info: ReadyInfo): Block[] {
  const blocks: Block[] = [];
  for (const raw of info.history) {
    const msg = raw as { role?: string; content?: string; id?: string };
    if (typeof msg.content !== 'string') continue;
    if (msg.role === 'user') {
      if (msg.id?.startsWith('msg_ctx_') || msg.content.startsWith('<environment>')) continue; // seeded fragment
      blocks.push({ id: nextId(), kind: 'user', text: msg.content });
    } else if (msg.role === 'assistant' && msg.content.length > 0) {
      blocks.push({ id: nextId(), kind: 'text', text: msg.content, streaming: false });
    }
  }
  return blocks;
}

/** Events that only touch the transcript (block list). */
type TranscriptEvent = Extract<
  KernelEvent,
  { type: 'user_message' | 'text_delta' | 'reasoning_delta' | 'tool_call_start' | 'tool_call_result' | 'tool_progress' | 'done' }
>;

/** Events that only touch run state (phase, approvals, queue, notices). */
type RunStateEvent = Extract<
  KernelEvent,
  { type: 'turn_start' | 'phase' | 'approval_request' | 'approval_resolved' | 'queue_update' | 'compaction' | 'notice' | 'run_failed' }
>;

function isTranscriptEvent(event: KernelEvent): event is TranscriptEvent {
  switch (event.type) {
    case 'user_message':
    case 'text_delta':
    case 'reasoning_delta':
    case 'tool_call_start':
    case 'tool_call_result':
    case 'tool_progress':
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
      return true;
    default:
      return false;
  }
}

/** Dispatch by family: transcript events and run-state events never overlap,
 *  so each reducer stays a small switch (the loop's data events have no
 *  transcript effect beyond what the families below already cover). */
function reduceEvent(state: UiState, event: KernelEvent): UiState {
  if (isTranscriptEvent(event)) return reduceTranscript(state, event);
  if (isRunStateEvent(event)) return reduceRunState(state, event);
  return state;
}

function reduceTranscript(state: UiState, event: TranscriptEvent): UiState {
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
        state: 'running',
      });
    case 'tool_call_result':
      return markToolResult(state, event.call.id, event.result.content);
    case 'tool_progress': {
      const tail = lastLine(event.text);
      return { ...state, blocks: mapTool(state, undefined, (b) => (b.state === 'running' ? { ...b, tail } : b)) };
    }
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

/** Rewrite tool rows by call id (all running rows when the id is unknown). */
function mapTool(state: UiState, callId: string | undefined, fn: (block: Extract<Block, { kind: 'tool' }>) => Block): Block[] {
  return state.blocks.map((b) => (b.kind === 'tool' && (callId === undefined || b.callId === callId) ? fn(b) : b));
}

function markToolResult(state: UiState, callId: string, content: string): UiState {
  const failed = isFailureText(content);
  return {
    ...state,
    blocks: mapTool(state, callId, (b) => ({ ...b, state: failed ? 'fail' : 'ok', detail: failed ? firstLine(content) : undefined })),
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

/** Mirror of the kernel's failure heuristic (presentation.ts) — kept minimal
 * client-side so the ui bundle doesn't reach into core internals. */
function isFailureText(content: string): boolean {
  return content.startsWith('Permission denied') || content.startsWith('Error:') || /^exit: [1-9]/m.test(content);
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim().length > 0) ?? '';
}

function lastLine(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('\n') + 1);
}
