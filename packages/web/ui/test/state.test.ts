import { describe, expect, it } from 'vitest';
import type { ApprovalRequest, KernelEvent, ToolCallView, ToolResultView } from '@nova-agent/core';
import type { ReadyInfo, WireBlock } from '../../src/protocol.js';
import { initialState, reduce, type Block, type UiState } from '../src/state.js';

/**
 * The reducer is the browser's whole brain: frames in, blocks out. These tests
 * pin the contracts it lives by — streaming coalescing, view-carrying tool
 * rows, approval clearing, the reconnect baseline — without a DOM in sight.
 */

const CALL = { id: 'c1', name: 'bash', args: { command: 'ls' }, rawArgs: '{"command":"ls"}' };
const TERMINAL_CALL: ToolCallView = { card: 'terminal', command: 'ls' };

type Frame = { event: KernelEvent; view?: ToolCallView; resultView?: ToolResultView };

/** Fold a scripted frame stream through the reducer — what the socket does. */
function fold(frames: Frame[], state: UiState = initialState): UiState {
  return frames.reduce((acc, frame) => reduce(acc, { type: 'event', ...frame }), state);
}

function toolResult(content: string, id = 'c1'): KernelEvent {
  return { type: 'tool_call_result', turn: 1, call: { ...CALL, id }, result: { id: 'r1', ts: 0, role: 'tool', toolCallId: id, name: 'bash', content } };
}

const EMPTY_STATS = { turns: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0, missTokens: 0, missTurns: 0 };

/** A `run_stats` event with the uninteresting fields filled in. */
function runStats(over: Partial<Extract<KernelEvent, { type: 'run_stats' }>['stats']>): KernelEvent {
  return {
    type: 'run_stats',
    stats: {
      startedAt: 1_700_000_000_000,
      durationMs: 1_000,
      llmMs: 1_000,
      toolMs: 0,
      requests: 1,
      toolCalls: 1,
      retries: 0,
      promptTokens: 100,
      completionTokens: 20,
      cachedTokens: 40,
      ...over,
    },
  };
}

function readyInfo(over: Partial<ReadyInfo> = {}): ReadyInfo {
  return {
    rootDir: 'D:/proj',
    sessionFile: 'D:/proj/s.jsonl',
    model: 'test-model',
    approvalMode: 'read-only',
    codeMode: 'native',
    history: [],
    historyTotal: 0,
    pendingApprovals: [],
    usedTokens: 0,
    ...over,
  };
}

function approvalRequest(id: string): ApprovalRequest {
  return { id, call: CALL, kind: 'read' };
}

function texts(blocks: Block[]): string[] {
  return blocks.map((b) => (b.kind === 'text' ? b.text : `<${b.kind}>`));
}

describe('reduce / connection', () => {
  it('marks the transcript disconnected without dropping it, and clears on reconnect', () => {
    const live = fold([{ event: { type: 'text_delta', messageId: 'm', text: 'hi' } }]);
    const down = reduce(live, { type: 'connection', connected: false });
    expect(down.phase).toBe('disconnected');
    expect(texts(down.blocks)).toEqual(['hi']);
    expect(reduce(down, { type: 'connection', connected: true }).phase).toBe('idle');
  });
});

describe('reduce / ready replay', () => {
  it('replaces the transcript with the host-projected baseline', () => {
    const history: WireBlock[] = [
      { kind: 'user', text: '问一句' },
      { kind: 'text', text: '答一句' },
      { kind: 'tool', callId: 'c1', name: 'bash', args: '{"command":"ls"}', view: TERMINAL_CALL, result: { card: 'terminal', output: 'ok', exitCode: 0 } },
      { kind: 'tool', callId: 'c2', name: 'read_file', args: '{"path":"a"}', view: { card: 'generic', kind: 'read', title: 'a' } },
    ];
    const state = reduce(fold([{ event: { type: 'text_delta', messageId: 'm', text: 'stale' } }]), {
      type: 'ready',
      info: readyInfo({ history, usedTokens: 1234, contextWindow: 200_000 }),
    });
    expect(state.connected).toBe(true);
    expect(state.blocks.map((b) => b.kind)).toEqual(['user', 'text', 'tool', 'tool']);
    expect(state.blocks[2]).toMatchObject({ kind: 'tool', callId: 'c1', result: { exitCode: 0 } });
    expect(state.blocks[3]).toMatchObject({ kind: 'tool', callId: 'c2' });
    expect(state.blocks[3]).not.toHaveProperty('result'); // no result logged for it
    expect(state.usedTokens).toBe(1234);
    expect(state.contextWindow).toBe(200_000);
  });

  it('adopts the reported modes, clears the session list and restores a pending approval', () => {
    const opened = reduce(fold([], initialState), { type: 'sessions', items: [{ file: 'f.jsonl', title: 't', mtime: 1 }] });
    expect(opened.sessions).toHaveLength(1);
    const state = reduce(opened, {
      type: 'ready',
      info: readyInfo({ approvalMode: 'full', codeMode: 'both', pendingApprovals: [approvalRequest('ap1')] }),
    });
    expect(state).toMatchObject({ approvalMode: 'full', codeMode: 'both', sessions: null });
    expect(state.pendingApproval?.id).toBe('ap1');
  });

  it('a state frame updates the modes without touching the transcript', () => {
    const live = fold([{ event: { type: 'text_delta', messageId: 'm', text: 'x' } }]);
    const switched = reduce(live, { type: 'state', approvalMode: 'auto-edit', codeMode: 'ptc' });
    expect(switched).toMatchObject({ approvalMode: 'auto-edit', codeMode: 'ptc' });
    expect(texts(switched.blocks)).toEqual(['x']);
  });
});

describe('reduce / streaming blocks', () => {
  it('coalesces consecutive deltas into one block and closes it on tool start', () => {
    const state = fold([
      { event: { type: 'text_delta', messageId: 'm', text: 'he' } },
      { event: { type: 'text_delta', messageId: 'm', text: 'llo' } },
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: { type: 'text_delta', messageId: 'm', text: 'after' } },
    ]);
    expect(state.blocks.map((b) => b.kind)).toEqual(['text', 'tool', 'text']);
    expect(state.blocks[0]).toMatchObject({ text: 'hello', streaming: false });
    expect(state.blocks[2]).toMatchObject({ text: 'after', streaming: true });
  });

  it('keeps reasoning in its own block, never merged into text', () => {
    const state = fold([
      { event: { type: 'reasoning_delta', text: 'think' } },
      { event: { type: 'text_delta', messageId: 'm', text: 'say' } },
    ]);
    expect(state.blocks.map((b) => b.kind)).toEqual(['reasoning', 'text']);
    expect(state.blocks[0]).toMatchObject({ text: 'think', streaming: false });
  });

  it('closes the open stream on done', () => {
    const state = fold([
      { event: { type: 'text_delta', messageId: 'm', text: 'x' } },
      { event: { type: 'done', stopReason: 'complete' } },
    ]);
    expect(state.blocks[0]).toMatchObject({ streaming: false });
  });
});

describe('reduce / tool rows carry server-resolved views', () => {
  it('stores the view the host sent with the call', () => {
    const state = fold([{ event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL }]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', view: { card: 'terminal', command: 'ls' } });
    expect(state.blocks[0]).not.toHaveProperty('result');
  });

  it('falls back to a generic card when the host sent no view at all', () => {
    const state = fold([{ event: { type: 'tool_call_start', turn: 1, call: CALL } }]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', view: { card: 'generic', kind: 'other', title: 'bash' } });
  });

  it('attaches the result view by call id and leaves siblings running', () => {
    const state = fold([
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: { type: 'tool_call_start', turn: 1, call: { ...CALL, id: 'c2' } }, view: TERMINAL_CALL },
      { event: toolResult('exit: 1\nboom'), resultView: { card: 'terminal', output: 'boom', exitCode: 1 } },
    ]);
    expect(state.blocks[0]).toMatchObject({ callId: 'c1', result: { exitCode: 1 } });
    expect(state.blocks[1]).toMatchObject({ callId: 'c2' });
    expect(state.blocks[1]).not.toHaveProperty('result');
  });

  it('feeds the last non-empty progress line to unfinished rows only', () => {
    const state = fold([
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: { type: 'tool_progress', callId: 'c1', text: 'line 1\nline 2\n' } },
      { event: toolResult('exit: 0\nok'), resultView: { card: 'terminal', output: 'ok', exitCode: 0 } },
      { event: { type: 'tool_progress', callId: 'c1', text: 'late' } },
    ]);
    expect(state.blocks[0]).toMatchObject({ tail: 'line 2' });
  });
});

describe('reduce / approvals, queue, phases', () => {
  it('clears only the approval that was resolved', () => {
    const pending = fold([{ event: { type: 'approval_request', request: approvalRequest('ap1') } }]);
    expect(pending.pendingApproval?.id).toBe('ap1');
    const other = fold([{ event: { type: 'approval_resolved', id: 'other', resolution: { source: 'aborted' } } }], pending);
    expect(other.pendingApproval?.id).toBe('ap1');
    const answered = fold(
      [{ event: { type: 'approval_resolved', id: 'ap1', resolution: { source: 'user', answer: 'deny' } } }],
      pending,
    );
    expect(answered.pendingApproval).toBeNull();
  });

  it('tracks the prompt queue and the phase verbatim', () => {
    const state = fold([
      { event: { type: 'queue_update', items: ['second', 'third'] } },
      { event: { type: 'phase', phase: 'tool' } },
    ]);
    expect(state.queued).toEqual(['second', 'third']);
    expect(state.phase).toBe('tool');
  });

  it('feeds the gauge from the last request consumption, not the cumulative total', () => {
    const state = fold([
      {
        event: {
          type: 'usage',
          usage: { promptTokens: 4200, completionTokens: 30, cachedTokens: 4000 },
          stats: { turns: 3, promptTokens: 99_000, completionTokens: 900, cachedTokens: 90_000, missTokens: 0, missTurns: 0 },
        },
      },
    ]);
    expect(state).toMatchObject({ usedTokens: 4200 });
  });
});

describe('reduce / hints', () => {
  it('renders compaction start and done as info hints', () => {
    const state = fold([
      { event: { type: 'compaction', progress: { state: 'start', trigger: 'auto' } } },
      { event: { type: 'compaction', progress: { state: 'done', trigger: 'auto', retained: 7 } } },
    ]);
    expect(state.blocks.map((b) => (b.kind === 'hint' ? b.tone : b.kind))).toEqual(['info', 'info']);
    expect(state.blocks[1]).toMatchObject({ text: expect.stringContaining('保留 7') });
  });

  it('maps the fuse notice to a warning and other notices to info', () => {
    expect(fold([{ event: { type: 'notice', code: 'compact_fused', text: '已停用自动压缩' } }]).blocks[0]).toMatchObject({ tone: 'warn' });
    expect(fold([{ event: { type: 'notice', code: 'compacted', text: '已自动压缩' } }]).blocks[0]).toMatchObject({ tone: 'info' });
  });

  it('distinguishes an abort from a failure', () => {
    const aborted = fold([
      { event: { type: 'text_delta', messageId: 'm', text: 'partial' } },
      { event: { type: 'run_failed', message: 'aborted by user', aborted: true } },
    ]);
    expect(aborted.blocks.map((b) => b.kind)).toEqual(['text', 'hint']);
    expect(aborted.blocks[0]).toMatchObject({ streaming: false });

    const failed = fold([{ event: { type: 'run_failed', message: 'provider 500', aborted: false } }]);
    expect(failed.blocks[0]).toMatchObject({ text: expect.stringContaining('provider 500'), tone: 'warn' });
  });

  it('surfaces host errors as a warning hint', () => {
    const state = reduce(initialState, { type: 'error', message: 'bad frame' });
    expect(state.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn' });
  });
});

describe('reduce / turn bookkeeping', () => {
  it('counts turns and ignores events with no transcript effect', () => {
    const state = fold([
      { event: { type: 'turn_start', turn: 1 } },
      { event: { type: 'turn_start', turn: 2 } },
      { event: { type: 'phase', phase: 'thinking' } },
      { event: { type: 'usage', usage: { promptTokens: 5, completionTokens: 1, cachedTokens: 0 }, stats: EMPTY_STATS } },
    ]);
    expect(state.turnCount).toBe(2);
    expect(state.blocks).toHaveLength(0);
    expect(state.usedTokens).toBe(5);
  });

  it('shows a re-request and an empty completion as warning hints', () => {
    const retried = fold([
      { event: { type: 'llm_retry', attempt: 2, maxRetries: 5, error: 'socket hang up', stats: EMPTY_STATS } },
    ]);
    expect(retried.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn', text: expect.stringContaining('2/5') });

    const empty = fold([{ event: { type: 'empty_completion', attempt: 1, maxRetries: 3, finishReason: 'stop' } }]);
    expect(empty.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn', text: expect.stringContaining('空补全') });
  });
});

describe('reduce / run stats', () => {
  it('records a run as one meta row and folds it into the session totals', () => {
    const first = fold([{ event: runStats({ durationMs: 12_000, firstTokenMs: 900, completionTokens: 40, llmMs: 2_000 }) }]);
    expect(first.blocks[0]).toMatchObject({ kind: 'meta' });
    expect(first.totals).toMatchObject({ runs: 1, requests: 1, toolCalls: 1, llmMs: 2_000, firstTokenMs: 900, firstTokenRuns: 1 });

    const second = fold([{ event: runStats({ durationMs: 3_000, completionTokens: 10, llmMs: 1_000 }) }], first);
    expect(second.totals).toMatchObject({ runs: 2, llmMs: 3_000, firstTokenRuns: 1, completionTokens: 50 });
    // A run that never streamed a token contributes no latency sample.
    expect(second.totals.firstTokenMs).toBe(900);
  });

  it('re-baselines the totals on ready: a resumed session does not inherit them', () => {
    const ran = fold([{ event: runStats({}) }]);
    expect(ran.totals.runs).toBe(1);
    const resumed = reduce(ran, { type: 'ready', info: readyInfo() });
    expect(resumed.totals.runs).toBe(0);
  });
});

describe('reduce / tool detail and jobs', () => {
  it('keeps the result text so the detail panel can show it', () => {
    const state = fold([
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: toolResult('line one\nline two') },
    ]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', output: 'line one\nline two' });
    expect(state.blocks[0]).toHaveProperty('ts');
  });

  it('upserts a background job in place instead of appending a row per update', () => {
    const job = (status: 'running' | 'completed', progress?: string): KernelEvent => ({
      type: 'job_update',
      job: { id: 'bash-1', kind: 'bash', label: 'pnpm build', status, ...(progress !== undefined ? { progress } : {}) },
    });
    const started = fold([{ event: job('running', 'starting') }]);
    expect(started.blocks).toHaveLength(1);
    const settled = fold([{ event: job('running', 'still going') }, { event: job('completed') }], started);
    expect(settled.blocks).toHaveLength(1);
    expect(settled.blocks[0]).toMatchObject({ kind: 'job', job: { id: 'bash-1', status: 'completed' } });
  });
});

describe('reduce / history pagination', () => {
  it('ships the tail and reports how much is still unloaded', () => {
    const history: WireBlock[] = [{ kind: 'user', text: 'q3' }, { kind: 'text', text: 'a3' }];
    const state = reduce(initialState, { type: 'ready', info: readyInfo({ history, historyTotal: 40 }) });
    expect(state.historyLoaded).toBe(2);
    expect(state.historyTotal).toBe(40);
  });

  it('prepends an older batch and advances the cursor', () => {
    const state = reduce(
      reduce(initialState, { type: 'ready', info: readyInfo({ history: [{ kind: 'user', text: 'q3' }], historyTotal: 3 }) }),
      {
        type: 'history_earlier',
        blocks: [{ kind: 'user', text: 'q1' }, { kind: 'text', text: 'a1' }],
        total: 3,
      },
    );
    expect(state.blocks.map((b) => (b.kind === 'user' || b.kind === 'text' ? b.text : `<${b.kind}>`))).toEqual(['q1', 'a1', 'q3']);
    expect(state.historyLoaded).toBe(3);
  });
});