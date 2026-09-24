/**
 * The `ready` replay baseline is a server-side projection of the durable log.
 * These tests pin what the browser is handed: which messages are visible, how
 * tool calls pair with results, and that views come from the tool registry
 * (with the generic fallback) rather than from name-keyed guessing.
 */
import { describe, expect, it } from 'vitest';
import { TURN_ABORTED_GUIDANCE, type AgentMessage, type ToolCall, type ToolViewSource } from '@nova-agent/core';
import { projectTranscript } from '../src/transcript.js';

function call(over: Partial<ToolCall> & { id: string; name: string }): ToolCall {
  return { args: {}, rawArgs: '{}', ...over };
}

const user = (id: string, content: string): AgentMessage => ({ id, ts: 0, role: 'user', content });
const assistant = (id: string, content: string, toolCalls?: ToolCall[]): AgentMessage => ({
  id,
  ts: 0,
  role: 'assistant',
  content,
  ...(toolCalls !== undefined ? { toolCalls } : {}),
});
const toolResult = (toolCallId: string, content: string): AgentMessage => ({
  id: `r_${toolCallId}`,
  ts: 0,
  role: 'tool',
  toolCallId,
  name: 'x',
  content,
});

const TOOLS: ToolViewSource[] = [
  {
    name: 'bash',
    presentCall: (args) => ({ card: 'terminal', command: String(args['command'] ?? '') }),
    presentResult: (_args, content) => ({ card: 'terminal', output: content, exitCode: content.startsWith('exit: 0') ? 0 : 1 }),
  },
  { name: 'read_file', presentResult: (args, content) => ({ card: 'read', path: String(args['path'] ?? ''), lineCount: content.split('\n').length, truncated: false }) },
];

describe('projectTranscript', () => {
  it('keeps user and assistant text, in order', () => {
    const blocks = projectTranscript([user('u1', '问'), assistant('a1', '答')], TOOLS);
    expect(blocks).toEqual([
      { kind: 'user', text: '问', ts: 0 },
      { kind: 'text', text: '答', ts: 0 },
    ]);
  });

  it('projects the seeded fragment as one context block per section, never as a user turn', () => {
    // Old logs carry fragments under plain ids, so the content prefix is also a
    // fragment marker (core's isContextFragment contract, mirrored exactly).
    const legacy: AgentMessage = { id: 'u0', ts: 0, role: 'user', content: '<environment>\ncwd=/w\ntoday=2026-09-24\n</environment>' };
    const blocks = projectTranscript([legacy, user('u1', 'real question'), assistant('a1', '')], TOOLS);
    expect(blocks).toEqual([
      {
        kind: 'context',
        tag: 'environment',
        form: 'snapshot',
        sections: [{ name: 'cwd', text: '/w' }, { name: 'today', text: '2026-09-24' }],
        text: 'cwd=/w\ntoday=2026-09-24',
      },
      { kind: 'user', text: 'real question', ts: 0 },
    ]);
  });

  it('keeps a section\'s bytes when its syntax is unreadable', () => {
    // A body whose lines are not `key=value` is not a table: the reader gets the
    // bytes in the text form rather than a partial account of them.
    const odd: AgentMessage = { id: 'msg_ctx_1', ts: 0, role: 'user', content: '<environment>\nfrom an older log\n</environment>' };
    expect(projectTranscript([odd], TOOLS)).toEqual([
      { kind: 'context', tag: 'environment', form: 'text', text: 'from an older log' },
    ]);
  });

  it('drops a fragment whose sections have no closing tag', () => {
    // Truncated or hand-edited context is not a section: rendering a row for it
    // would attribute bytes to a producer that never wrote them.
    expect(projectTranscript([user('u0', '<environment>half a fragment')], TOOLS)).toEqual([]);
  });

  it('renders a tool call with its resolved view, its result and the text the detail panel shows', () => {
    const toolCall = call({ id: 'c1', name: 'bash', args: { command: 'ls' }, rawArgs: '{"command":"ls"}' });
    const blocks = projectTranscript(
      [user('u1', 'go'), assistant('a1', '', [toolCall]), toolResult('c1', 'exit: 0\nstdout:\nok')],
      TOOLS,
    );
    expect(blocks).toEqual([
      { kind: 'user', text: 'go', ts: 0 },
      {
        kind: 'tool',
        callId: 'c1',
        name: 'bash',
        args: '{"command":"ls"}',
        view: { card: 'terminal', command: 'ls' },
        // The replayed row needs the result TEXT as well as its view: the live
        // event stream that carried it is long gone by the time a client
        // attaches, and the detail panel must still open on an old row.
        output: 'exit: 0\nstdout:\nok',
        ts: 0,
        result: { card: 'terminal', output: 'exit: 0\nstdout:\nok', exitCode: 0 },
      },
    ]);
  });

  it('pairs out of order and leaves an unfinished call without a result', () => {
    const a = call({ id: 'c1', name: 'read_file', args: { path: 'a.ts' } });
    const b = call({ id: 'c2', name: 'read_file', args: { path: 'b.ts' } });
    const blocks = projectTranscript(
      [assistant('a1', '', [a, b]), toolResult('c2', 'line one\nline two'), toolResult('c1', 'x')],
      TOOLS,
    );
    const tools = blocks.filter((blk) => blk.kind === 'tool');
    expect(tools.map((t) => t.kind === 'tool' && t.result !== undefined)).toEqual([true, true]);
    const orphan = projectTranscript([toolResult('c9', 'never requested')], TOOLS);
    expect(orphan).toEqual([]); // a result with no call is not invented into a block
  });

  it('gives an undeclared tool the generic card instead of dropping it', () => {
    const toolCall = call({ id: 'c1', name: 'third_party', args: { path: 'src/x.ts', verbose: true } });
    const blocks = projectTranscript([assistant('a1', '', [toolCall]), toolResult('c1', 'Error: boom')], TOOLS);
    expect(blocks[0]).toMatchObject({
      kind: 'tool',
      view: { card: 'generic', kind: 'other', title: 'src/x.ts' },
      result: { card: 'generic', ok: false, text: 'Error: boom' },
    });
  });

  it('replays the run measurement right after the message it closed', () => {
    const stats = {
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
    const messages = [user('u1', 'hi'), assistant('a1', 'ok')];
    const blocks = projectTranscript(messages, TOOLS, [
      { type: 'message', message: messages[0] as AgentMessage },
      { type: 'message', message: messages[1] as AgentMessage },
      { type: 'run/stats', stats, afterMessageId: 'a1', at: 1 },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'text', 'meta']);
    expect(blocks[2]).toEqual({ kind: 'meta', stats, ts: stats.startedAt });
    // An anchor the projection no longer surfaces drops its row rather than
    // moving the numbers onto a message they did not measure.
    const orphaned = projectTranscript(messages, TOOLS, [
      { type: 'run/stats', stats, afterMessageId: 'gone', at: 1 },
    ]);
    expect(orphaned.map((b) => b.kind)).toEqual(['user', 'text']);
  });

  it('drops system and compaction bookkeeping rows', () => {
    const sys: AgentMessage = { id: 's1', ts: 0, role: 'system', content: 'persona' };
    expect(projectTranscript([sys, user('u1', 'hi')], TOOLS)).toEqual([{ kind: 'user', text: 'hi', ts: 0 }]);
  });

  it('replays an interrupted turn as a marker, never as something the user said', () => {
    // Core logs the abort marker as a plain user message for the model's sake
    // (the next request has to know the turn was cut short). Replaying it as a
    // prompt bubble would fabricate a user turn that never happened.
    const marker = user('msg_abort', TURN_ABORTED_GUIDANCE);
    const blocks = projectTranscript([user('u1', '跑测试'), marker, assistant('a1', '')], TOOLS);
    expect(blocks).toEqual([{ kind: 'user', text: '跑测试', ts: 0 }, { kind: 'aborted' }]);
  });
});