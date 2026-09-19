import { describe, expect, it } from 'vitest';
import type { ApprovalRequest, KernelEvent } from '@nova-agent/core';
import type { ReadyInfo } from '../../src/protocol.js';
import { initialState, reduce, type Block, type UiState } from '../src/state.js';

/** Fold a scripted event stream through the reducer — the browser's whole job. */
function fold(events: KernelEvent[], state: UiState = initialState): UiState {
  return events.reduce((acc, event) => reduce(acc, { type: 'event', event }), state);
}

const CALL = { id: 'c1', name: 'read_file', args: { path: 'a.ts' }, rawArgs: '{"path":"a.ts"}' };

function toolResult(content: string, id = 'c1') {
  return { id: 'r1', ts: 0, role: 'tool' as const, toolCallId: id, name: 'read_file', content };
}

function approvalRequest(id: string): ApprovalRequest {
  return { id, call: CALL, kind: 'read' };
}

function readyInfo(over: Partial<ReadyInfo> = {}): ReadyInfo {
  return {
    rootDir: 'D:/proj',
    sessionFile: 'D:/proj/s.jsonl',
    model: 'test-model',
    approvalMode: 'read-only',
    codeMode: 'native',
    history: [],
    pendingApprovals: [],
    ...over,
  };
}

function texts(blocks: Block[]): string[] {
  return blocks.map((b) => (b.kind === 'text' ? b.text : `<${b.kind}>`));
}

describe('reduce / connection', () => {
  it('marks the transcript disconnected without dropping it', () => {
    const live = fold([{ type: 'text_delta', messageId: 'm', text: 'hi' }]);
    const down = reduce(live, { type: 'connection', connected: false });
    expect(down.phase).toBe('disconnected');
    expect(texts(down.blocks)).toEqual(['hi']);
    expect(reduce(down, { type: 'connection', connected: true }).phase).not.toBe('disconnected');
  });
});

describe('reduce / ready replay', () => {
  it('replaces the transcript with the log baseline', () => {
    const state = reduce(fold([{ type: 'text_delta', messageId: 'm', text: 'stale' }]), {
      type: 'ready',
      info: readyInfo({
        history: [
          { id: 'msg_1', role: 'user', content: '问一句' },
          { id: 'msg_2', role: 'assistant', content: '答一句' },
        ],
      }),
    });
    expect(state.connected).toBe(true);
    expect(state.blocks.map((b) => b.kind)).toEqual(['user', 'text']);
    expect(state.blocks[1]).toMatchObject({ text: '答一句', streaming: false });
  });

  it('skips the seeded context fragment on replay', () => {
    const state = reduce(initialState, {
      type: 'ready',
      info: readyInfo({
        history: [
          { id: 'msg_ctx_1', role: 'user', content: '<environment>cwd=…</environment>' },
          { id: 'msg_1', role: 'user', content: '<environment>typed by the user' },
          { role: 'assistant', content: '' },
          { id: 'msg_3', role: 'assistant', content: 'real' },
        ],
      }),
    });
    // Both fragment forms are dropped; the empty assistant message is dropped too.
    expect(texts(state.blocks)).toEqual(['real']);
  });

  it('restores a pending approval from the baseline', () => {
    const state = reduce(initialState, {
      type: 'ready',
      info: readyInfo({ pendingApprovals: [approvalRequest('ap1')] }),
    });
    expect(state.pendingApproval?.id).toBe('ap1');
  });
});

describe('reduce / streaming blocks', () => {
  it('coalesces consecutive deltas into one block and closes it on tool start', () => {
    const state = fold([
      { type: 'text_delta', messageId: 'm', text: 'he' },
      { type: 'text_delta', messageId: 'm', text: 'llo' },
      { type: 'tool_call_start', turn: 1, call: CALL },
      { type: 'text_delta', messageId: 'm', text: 'after' },
    ]);
    expect(state.blocks.map((b) => b.kind)).toEqual(['text', 'tool', 'text']);
    expect(state.blocks[0]).toMatchObject({ text: 'hello', streaming: false });
    expect(state.blocks[2]).toMatchObject({ text: 'after', streaming: true });
  });

  it('keeps reasoning in its own block, never merged into text', () => {
    const state = fold([
      { type: 'reasoning_delta', text: 'think' },
      { type: 'text_delta', messageId: 'm', text: 'say' },
    ]);
    expect(state.blocks.map((b) => b.kind)).toEqual(['reasoning', 'text']);
    expect(state.blocks[0]).toMatchObject({ text: 'think', streaming: false });
  });

  it('closes the open stream on done', () => {
    const state = fold([
      { type: 'text_delta', messageId: 'm', text: 'x' },
      { type: 'done', stopReason: 'complete' },
    ]);
    expect(state.blocks[0]).toMatchObject({ streaming: false });
  });
});

describe('reduce / tool rows', () => {
  it('marks the matching call failed and keeps the first error line', () => {
    const state = fold([
      { type: 'tool_call_start', turn: 1, call: CALL },
      { type: 'tool_call_result', turn: 1, call: CALL, result: toolResult('exit: 1\nboom') },
    ]);
    expect(state.blocks[0]).toMatchObject({ state: 'fail', detail: 'exit: 1' });
  });

  it('treats a permission denial and a call error as failures', () => {
    for (const content of ['Permission denied: by user: 太危险', 'Error: ENOENT']) {
      const state = fold([
        { type: 'tool_call_start', turn: 1, call: CALL },
        { type: 'tool_call_result', turn: 1, call: CALL, result: toolResult(content) },
      ]);
      expect(state.blocks[0]).toMatchObject({ state: 'fail' });
    }
  });

  it('leaves other calls alone and keeps succeeded rows without a detail', () => {
    const state = fold([
      { type: 'tool_call_start', turn: 1, call: CALL },
      { type: 'tool_call_start', turn: 1, call: { ...CALL, id: 'c2' } },
      { type: 'tool_call_result', turn: 1, call: CALL, result: toolResult('ok') },
    ]);
    expect(state.blocks[0]).toMatchObject({ state: 'ok', detail: undefined });
    expect(state.blocks[1]).toMatchObject({ callId: 'c2', state: 'running' });
  });

  it('feeds the last non-empty progress line to running rows only', () => {
    const state = fold([
      { type: 'tool_call_start', turn: 1, call: CALL },
      { type: 'tool_progress', callId: 'c1', text: 'line 1\nline 2\n' },
      { type: 'tool_call_result', turn: 1, call: CALL, result: toolResult('ok') },
      { type: 'tool_progress', callId: 'c1', text: 'late' },
    ]);
    expect(state.blocks[0]).toMatchObject({ tail: 'line 2' });
  });
});

describe('reduce / approvals, queue, phases', () => {
  it('clears only the approval that was resolved', () => {
    const pending = fold([{ type: 'approval_request', request: approvalRequest('ap1') }]);
    expect(pending.pendingApproval?.id).toBe('ap1');
    const other = fold(
      [{ type: 'approval_resolved', id: 'other', resolution: { source: 'aborted' } }],
      pending,
    );
    expect(other.pendingApproval?.id).toBe('ap1');
    const answered = fold(
      [{ type: 'approval_resolved', id: 'ap1', resolution: { source: 'user', answer: 'deny' } }],
      pending,
    );
    expect(answered.pendingApproval).toBeNull();
  });

  it('tracks the prompt queue and the phase verbatim', () => {
    const state = fold([
      { type: 'queue_update', items: ['second', 'third'] },
      { type: 'phase', phase: 'tool' },
    ]);
    expect(state.queued).toEqual(['second', 'third']);
    expect(state.phase).toBe('tool');
  });
});

describe('reduce / hints', () => {
  it('renders compaction start and done as info hints', () => {
    const state = fold([
      { type: 'compaction', progress: { state: 'start', trigger: 'auto' } },
      { type: 'compaction', progress: { state: 'done', trigger: 'auto', retained: 7 } },
    ]);
    expect(state.blocks.map((b) => (b.kind === 'hint' ? b.tone : b.kind))).toEqual(['info', 'info']);
    expect(state.blocks[1]).toMatchObject({ text: expect.stringContaining('保留 7') });
  });

  it('maps the fuse notice to a warning and other notices to info', () => {
    const fused = fold([{ type: 'notice', code: 'compact_fused', text: '已停用自动压缩' }]);
    expect(fused.blocks[0]).toMatchObject({ tone: 'warn' });
    const other = fold([{ type: 'notice', code: 'compacted', text: '已自动压缩' }]);
    expect(other.blocks[0]).toMatchObject({ tone: 'info' });
  });

  it('distinguishes an abort from a failure', () => {
    const aborted = fold([
      { type: 'text_delta', messageId: 'm', text: 'partial' },
      { type: 'run_failed', message: 'aborted by user', aborted: true },
    ]);
    expect(aborted.blocks.map((b) => b.kind)).toEqual(['text', 'hint']);
    expect(aborted.blocks[0]).toMatchObject({ streaming: false });

    const failed = fold([{ type: 'run_failed', message: 'provider 500', aborted: false }]);
    expect(failed.blocks[0]).toMatchObject({ text: expect.stringContaining('provider 500'), tone: 'warn' });
  });

  it('surfaces host errors as a warning hint', () => {
    const state = reduce(initialState, { type: 'error', message: 'bad frame' });
    expect(state.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn' });
  });
});

describe('reduce / turn bookkeeping', () => {
  it('counts turns and ignores unknown events', () => {
    const state = fold([
      { type: 'turn_start', turn: 1 },
      { type: 'turn_start', turn: 2 },
      { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stats: {} } as KernelEvent,
    ]);
    expect(state.turnCount).toBe(2);
  });
});