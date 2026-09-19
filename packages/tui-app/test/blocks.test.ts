/**
 * The reducer is the transcript's only source of truth, so these tests pin the
 * things a screenshot cannot distinguish but a user feels: deltas merge into
 * one growing paragraph, a tool result pairs with its call, live rows replace
 * themselves instead of stacking, and an aborted turn closes its stream.
 */
import { describe, expect, it } from 'vitest';
import type { KernelEvent, ToolCall, ToolViewSource } from '@nova-agent/core';
import { initialTranscript, reduce, type Block, type TranscriptState } from '../src/blocks.js';

const tools: ToolViewSource[] = [
  {
    name: 'read_file',
    presentCall: (args) => ({ card: 'generic', kind: 'read', title: String(args['path'] ?? '') }),
    presentResult: (args, content) => ({ card: 'read', path: String(args['path'] ?? ''), lineCount: content.split('\n').length, truncated: false }),
  },
  { name: 'bash', presentCall: (args) => ({ card: 'terminal', command: String(args['command'] ?? '') }) },
  { name: 'browser_tool' },
];

const call = (name: string, args: Record<string, unknown>, id = 'c1'): ToolCall => ({ id, name, args, rawArgs: JSON.stringify(args) });

function run(events: readonly KernelEvent[], start: TranscriptState = initialTranscript): TranscriptState {
  return events.reduce((state, event) => reduce(state, event, { tools: () => tools, now: 1_000 }), start);
}

const kinds = (state: TranscriptState): string[] => state.blocks.map((b) => b.kind);

describe('prose blocks', () => {
  it('merges deltas into one growing block, per stream kind', () => {
    const state = run([
      { type: 'reasoning_delta', text: '想' },
      { type: 'reasoning_delta', text: '了想' },
      { type: 'text_delta', messageId: 'm1', text: '答' },
      { type: 'text_delta', messageId: 'm1', text: '案' },
    ]);
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[0]).toMatchObject({ kind: 'reasoning', text: '想了想' });
    expect(state.blocks[1]).toMatchObject({ kind: 'text', text: '答案', streaming: true });
  });

  it('a new block ends the previous stream', () => {
    const state = run([
      { type: 'text_delta', messageId: 'm1', text: 'first' },
      { type: 'user_message', message: { id: 'u1', ts: 0, role: 'user', content: 'next question' } },
    ]);
    expect(state.blocks[0]).toMatchObject({ kind: 'text', streaming: false });
    expect(state.blocks[1]).toMatchObject({ kind: 'user', text: 'next question' });
  });

  it('a message event closes the stream without adding a block', () => {
    const state = run([
      { type: 'text_delta', messageId: 'm1', text: 'done' },
      { type: 'message', message: { id: 'm1', ts: 0, role: 'assistant', content: 'done' } },
    ]);
    expect(kinds(state)).toEqual(['text']);
    expect(state.blocks[0]).toMatchObject({ streaming: false });
  });
});

describe('tool rows', () => {
  const start: KernelEvent = { type: 'tool_call_start', turn: 1, call: call('read_file', { path: 'src/a.ts' }) };
  const finish: KernelEvent = {
    type: 'tool_call_result',
    turn: 1,
    call: call('read_file', { path: 'src/a.ts' }),
    result: { id: 'r1', ts: 0, role: 'tool', toolCallId: 'c1', name: 'read_file', content: 'line one\nline two' },
  };

  it('resolves the call view from the live tool registry', () => {
    const state = run([start]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', view: { card: 'generic', kind: 'read', title: 'src/a.ts' }, failed: false });
  });

  it('pairs the result with its call and records the view, verdict and timing', () => {
    const state = run([start, finish]);
    const block = state.blocks[0];
    expect(block).toMatchObject({ kind: 'tool', failed: false, endedAt: 1_000, result: { card: 'read', path: 'src/a.ts', lineCount: 2 } });
  });

  it('an undeclared tool still renders from the generic card', () => {
    const state = run([{ type: 'tool_call_start', turn: 1, call: call('browser_tool', { url: 'x' }) }]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', view: { card: 'generic', kind: 'other' } });
  });

  it('marks a failing result as failed', () => {
    const denied: KernelEvent = {
      type: 'tool_call_result',
      turn: 1,
      call: call('bash', { command: 'rm -rf /' }, 'c9'),
      result: { id: 'r2', ts: 0, role: 'tool', toolCallId: 'c9', name: 'bash', content: 'Permission denied: by user' },
    };
    const state = run([{ type: 'tool_call_start', turn: 1, call: call('bash', { command: 'rm -rf /' }, 'c9') }, denied]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', failed: true, view: { card: 'terminal' } });
  });

  it('keeps the tail of a running call, and only while it runs', () => {
    const state = run([start, { type: 'tool_progress', callId: 'c1', text: 'building…\nstep 3' }]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', tail: 'step 3' });
    const after = run([finish], state);
    expect(after.blocks[0]).toMatchObject({ kind: 'tool' });
    expect((after.blocks[0] as Extract<Block, { kind: 'tool' }>).tail).toBe('step 3'); // text survives; the row decides not to show it
  });
});

describe('run state', () => {
  it('tracks phase, queue, approvals and usage', () => {
    const state = run([
      { type: 'phase', phase: 'tool' },
      { type: 'queue_update', items: ['a', 'b'] },
      { type: 'usage', usage: { promptTokens: 1234, completionTokens: 10, totalTokens: 1244 }, stats: {} as never },
      { type: 'approval_request', request: { id: 'apr1', kind: 'execute', call: call('bash', { command: 'ls' }) } as never },
    ]);
    expect(state.phase).toBe('tool');
    expect(state.queued).toEqual(['a', 'b']);
    expect(state.promptTokens).toBe(1234);
    expect(state.pending?.id).toBe('apr1');
    expect(run([{ type: 'approval_resolved', id: 'apr1', resolution: { source: 'user', answer: 'deny' } }], state).pending).toBeNull();
  });

  it('starts the turn clock once, and stops it on done', () => {
    const running = run([{ type: 'turn_start', turn: 1 }, { type: 'turn_start', turn: 1 }]);
    expect(running.turnCount).toBe(2);
    expect(running.turnStartedAt).toBe(1_000);
    const done = reduce(running, { type: 'done', stopReason: 'complete' }, { tools: () => tools, now: 4_500 });
    expect(done.turnStartedAt).toBeUndefined();
    expect(done.lastTurnMs).toBe(3_500);
  });

  it('live rows update in place instead of stacking', () => {
    const state = run([
      { type: 'llm_retry', attempt: 1, maxRetries: 3, error: 'stream died', stats: {} as never },
      { type: 'llm_retry', attempt: 2, maxRetries: 3, error: 'stream died', stats: {} as never },
    ]);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ text: expect.stringContaining('2/3') as unknown as string });
  });

  it('an aborted turn closes its stream and says so', () => {
    const state = run([
      { type: 'text_delta', messageId: 'm1', text: 'partial answer' },
      { type: 'run_failed', message: 'aborted', aborted: true },
    ]);
    expect(state.blocks[0]).toMatchObject({ streaming: false });
    expect(state.blocks[1]).toMatchObject({ kind: 'hint', tone: 'warn', text: '已中断' });
    expect(state.turnStartedAt).toBeUndefined();
    expect(state.phase).toBe('idle');
  });

  it('a compaction announces itself once and then reports the outcome', () => {
    const started = run([{ type: 'compaction', progress: { state: 'start', trigger: 'auto' } }]);
    const done = run([{ type: 'compaction', progress: { state: 'done', trigger: 'auto', retained: 12 } }], started);
    expect(done.blocks).toHaveLength(1);
    expect(done.blocks[0]).toMatchObject({ text: expect.stringContaining('12') as unknown as string });
  });
});