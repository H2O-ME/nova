/**
 * The `ready` replay baseline is a server-side projection of the durable log.
 * These tests pin what the browser is handed: which messages are visible, how
 * tool calls pair with results, and that views come from the tool registry
 * (with the generic fallback) rather than from name-keyed guessing.
 */
import { describe, expect, it } from 'vitest';
import type { AgentMessage, ToolCall, ToolViewSource } from '@nova-agent/core';
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
      { kind: 'user', text: '问' },
      { kind: 'text', text: '答' },
    ]);
  });

  it('drops the seeded session-start fragment, by id and by the legacy content fallback', () => {
    const seeded: AgentMessage = { id: 'msg_ctx_1', ts: 0, role: 'user', content: '<environment>cwd=…</environment>' };
    // Old logs carry fragments under plain ids, so the content prefix is also a
    // fragment marker (core's isContextFragment contract, mirrored exactly).
    const legacy: AgentMessage = { id: 'u0', ts: 0, role: 'user', content: '<environment>from an older log' };
    const blocks = projectTranscript([seeded, legacy, user('u1', 'real question'), assistant('a1', '')], TOOLS);
    expect(blocks).toEqual([{ kind: 'user', text: 'real question' }]);
  });

  it('renders a tool call with its resolved view and paired result', () => {
    const toolCall = call({ id: 'c1', name: 'bash', args: { command: 'ls' }, rawArgs: '{"command":"ls"}' });
    const blocks = projectTranscript(
      [user('u1', 'go'), assistant('a1', '', [toolCall]), toolResult('c1', 'exit: 0\nstdout:\nok')],
      TOOLS,
    );
    expect(blocks).toEqual([
      { kind: 'user', text: 'go' },
      {
        kind: 'tool',
        callId: 'c1',
        name: 'bash',
        args: '{"command":"ls"}',
        view: { card: 'terminal', command: 'ls' },
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

  it('drops system and compaction bookkeeping rows', () => {
    const sys: AgentMessage = { id: 's1', ts: 0, role: 'system', content: 'persona' };
    expect(projectTranscript([sys, user('u1', 'hi')], TOOLS)).toEqual([{ kind: 'user', text: 'hi' }]);
  });
});