/**
 * The 轨迹 view reads the durable log, so its projection is what decides what a
 * reader can see of it. These tests pin the two rules it lives by: every event
 * type becomes a row (a new event type silently vanishing from the trace would
 * make the view lie about the log), and a message preview is bounded and
 * one-line here rather than by every client.
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@nova-agent/core';
import { projectTrace } from '../src/trace.js';

/** A run's measurement, as the kernel logs it (the numbers only it can know). */
const RUN_STATS = {
  startedAt: 1_700_000_000_000,
  durationMs: 4_000,
  firstTokenMs: 2_300,
  llmMs: 3_000,
  toolMs: 0,
  requests: 2,
  toolCalls: 0,
  retries: 0,
  promptTokens: 100,
  completionTokens: 20,
  cachedTokens: 40,
};

const message = (over: Partial<Extract<SessionEvent, { type: 'message' }>['message']> = {}): SessionEvent => ({
  type: 'message',
  message: { id: 'm1', ts: 1_700_000_000_000, role: 'user', content: 'hello', ...over },
});

describe('projectTrace', () => {
  it('carries every event type the log can hold', () => {
    const events: SessionEvent[] = [
      message(),
      { type: 'compaction/start', trigger: 'auto', at: 1 },
      { type: 'compaction/summary', summary: 's', keep: [], shadowedTokenCount: 1200, at: 2 },
      { type: 'compaction/end', at: 3 },
      { type: 'todo/write', todos: [{ text: 'a', status: 'completed' }, { text: 'b', status: 'in_progress' }], at: 4 },
      { type: 'approval', toolName: 'bash', kind: 'execute', outcome: 'always', at: 5 },
      { type: 'workspace', path: 'D:/w', at: 6 },
      { type: 'code-dispatch', toolName: 'read_file', argsPreview: '{}', isError: false, resultPreview: 'ok', at: 7 },
      { type: 'run/stats', stats: RUN_STATS, at: 8 },
    ];
    const rows = projectTrace(events);
    expect(rows.map((row) => row.kind)).toEqual([
      'message', 'compaction', 'compaction', 'compaction', 'todo', 'approval', 'workspace', 'dispatch', 'run',
    ]);
    expect(rows[8]).toEqual({ kind: 'run', ts: 8, stats: RUN_STATS });
    expect(rows[4]).toEqual({ kind: 'todo', ts: 4, total: 2, open: 1 });
    expect(rows[2]).toEqual({ kind: 'compaction', ts: 2, phase: 'summary', tokens: 1200 });
    expect(rows[5]).toEqual({ kind: 'approval', ts: 5, tool: 'bash', request: 'execute', outcome: 'always' });
  });

  it('marks the seeded session-start fragment as an injection, not a user turn', () => {
    const seeded: SessionEvent = {
      type: 'message',
      message: { id: 'msg_ctx_1', ts: 9, role: 'user', content: '<environment>\ncwd=/w\n</environment>' },
    };
    const rows = projectTrace([seeded, message()]);
    expect(rows[0]).toMatchObject({ kind: 'message', context: true, role: 'user' });
    expect(rows[1]).not.toHaveProperty('context');
  });

  it('keeps the log\'s own order (oldest first)', () => {
    const rows = projectTrace([{ type: 'workspace', path: 'a', at: 1 }, { type: 'workspace', path: 'b', at: 2 }]);
    expect(rows.map((row) => (row.kind === 'workspace' ? row.path : ''))).toEqual(['a', 'b']);
  });

  it('bounds a message to its first line, capped', () => {
    const long = `${'x'.repeat(400)}\nsecond line`;
    const rows = projectTrace([message({ content: `\n\n${long}` })]);
    expect(rows[0]).toMatchObject({ kind: 'message', role: 'user' });
    const preview = rows[0]?.kind === 'message' ? rows[0].preview : '';
    expect(preview).toHaveLength(201); // 200 + the ellipsis
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toContain('second line');
  });

  it('reports the tool calls an assistant message carried, and the tool a result came from', () => {
    const assistant = message({
      role: 'assistant',
      content: 'done',
      toolCalls: [{ id: 'c1', name: 'bash', args: {}, rawArgs: '{}' }, { id: 'c2', name: 'read_file', args: {}, rawArgs: '{}' }],
    } as never);
    const result: SessionEvent = {
      type: 'message',
      message: { id: 'r1', ts: 2, role: 'tool', toolCallId: 'c1', name: 'bash', content: 'exit: 0' },
    };
    const rows = projectTrace([assistant, result]);
    expect(rows[0]).toMatchObject({ kind: 'message', role: 'assistant', tools: 2 });
    expect(rows[1]).toMatchObject({ kind: 'message', role: 'tool', tools: 0, name: 'bash', preview: 'exit: 0' });
  });

  it('reports a compaction failure, because a silent one would read as a success', () => {
    const rows = projectTrace([{ type: 'compaction/end', at: 1, error: 'summary call failed' }]);
    expect(rows[0]).toEqual({ kind: 'compaction', ts: 1, phase: 'end', error: 'summary call failed' });
  });
});