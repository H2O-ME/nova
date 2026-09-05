import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TURN_ABORTED_GUIDANCE,
  LENGTH_CUTOFF_TOOL_GUIDANCE,
  getTimeTool,
  runAgent,
  type AgentEvent,
  type AgentMessage,
  type ChatProvider,
  type StreamEvent,
  type ToolDefinition,
  type ToolResultMessage,
} from '../src/index.js';

function scriptedProvider(scripts: StreamEvent[][]): ChatProvider {
  let call = 0;
  return {
    async *stream() {
      const events = scripts[call] ?? [];
      call += 1;
      for (const ev of events) yield ev;
    },
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe('runAgent', () => {
  it('streams a plain text answer and records usage', async () => {
    const provider = scriptedProvider([
      [
        { type: 'text_delta', text: 'Hel' },
        { type: 'text_delta', text: 'lo' },
        { type: 'usage', usage: { promptTokens: 10, completionTokens: 5, cachedTokens: 8 } },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(runAgent({ provider, messages, rootDir: '.' }));

    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'text_delta',
      'text_delta',
      'usage',
      'message',
      'done',
    ]);
    expect(messages).toHaveLength(1);
    const assistant = messages.find((m): m is Extract<AgentMessage, { role: 'assistant' }> => m.role === 'assistant');
    expect(assistant?.content).toBe('Hello');
    expect(assistant?.usage).toEqual({ promptTokens: 10, completionTokens: 5, cachedTokens: 8 });
    const done = events.at(-1);
    expect(done?.type).toBe('done');
  });

  it('executes a tool call and feeds the result back in the next turn', async () => {
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'call_1', name: 'get_time', argsDelta: '{"time' },
        { type: 'tool_call_delta', index: 0, argsDelta: 'zone":"UTC"}' },
        { type: 'usage', usage: { promptTokens: 20, completionTokens: 8, cachedTokens: 0 } },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'It is UTC now.' },
        { type: 'usage', usage: { promptTokens: 40, completionTokens: 6, cachedTokens: 20 } },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(runAgent({ provider, messages, rootDir: '.', tools: [getTimeTool] }));

    expect(messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    const toolResult = messages.find((m): m is ToolResultMessage => m.role === 'tool');
    expect(toolResult?.toolCallId).toBe('call_1');
    expect(toolResult?.name).toBe('get_time');
    expect(toolResult?.content).toContain('(UTC)');

    const start = events.find((e): e is Extract<AgentEvent, { type: 'tool_call_start' }> => e.type === 'tool_call_start');
    expect(start?.call.args).toEqual({ timezone: 'UTC' });

    const lastUsage = events
      .filter((e): e is Extract<AgentEvent, { type: 'usage' }> => e.type === 'usage')
      .at(-1);
    expect(lastUsage?.stats).toEqual({
      turns: 2,
      promptTokens: 60,
      completionTokens: 14,
      cachedTokens: 20,
      // turn-2 miss is 40-20=20 tokens, far below the 1024 noise floor
      missTokens: 0,
      missTurns: 0,
    });
  });

  it('does not let empty-string id/name deltas overwrite captured values', async () => {
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'call_1', name: 'get_time', argsDelta: '' },
        { type: 'tool_call_delta', index: 0, id: '', name: '', argsDelta: '{"timezone":"UTC"}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'ok' }, { type: 'finish', finishReason: 'stop' }],
    ]);
    const messages: AgentMessage[] = [];
    await collect(runAgent({ provider, messages, rootDir: '.', tools: [getTimeTool] }));

    const assistant = messages.find(
      (m): m is Extract<AgentMessage, { role: 'assistant' }> => m.role === 'assistant' && m.toolCalls !== undefined,
    );
    expect(assistant?.toolCalls?.[0]).toMatchObject({
      id: 'call_1',
      name: 'get_time',
      args: { timezone: 'UTC' },
    });
    const toolResult = messages.find((m): m is ToolResultMessage => m.role === 'tool');
    expect(toolResult?.name).toBe('get_time');
  });

  it('reports an error result for an unknown tool instead of throwing', async () => {
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'c1', name: 'nope', argsDelta: '{}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'ack' }, { type: 'finish', finishReason: 'stop' }],
    ]);
    const messages: AgentMessage[] = [];
    await collect(runAgent({ provider, messages, rootDir: '.' }));
    const toolResult = messages.find((m): m is ToolResultMessage => m.role === 'tool');
    expect(toolResult?.content).toBe('Error: unknown tool "nope"');
  });

  it('offloads oversized tool results to disk and keeps a reference', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'nova-agent-'));
    const big = 'x'.repeat(500);
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'c1', name: 'big', argsDelta: '{}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'ok' }, { type: 'finish', finishReason: 'stop' }],
    ]);
    const bigTool: ToolDefinition = {
      name: 'big',
      description: 'returns a big string',
      parameters: { type: 'object' },
      execute: () => big,
    };
    const messages: AgentMessage[] = [];
    await collect(
      runAgent({
        provider,
        messages,
        rootDir: tmp,
        tools: [bigTool],
        maxToolResultBytes: 100,
        cacheDir: path.join(tmp, 'cache'),
      }),
    );
    const toolResult = messages.find((m): m is ToolResultMessage => m.role === 'tool');
    expect(toolResult?.truncatedRef).toBeTruthy();
    const full = await readFile(toolResult?.truncatedRef ?? '', 'utf8');
    expect(full).toBe(big);
    expect(toolResult?.content).toContain('[truncated');
    // head+tail truncation: the tail carries the most recent output
    expect(toolResult?.content.startsWith('x'.repeat(60))).toBe(true);
    expect(toolResult?.content.endsWith('x'.repeat(40))).toBe(true);
  });

  it('forwards reasoning deltas as events without persisting them', async () => {
    const provider = scriptedProvider([
      [
        { type: 'reasoning_delta', text: 'thinking ' },
        { type: 'reasoning_delta', text: 'hard' },
        { type: 'text_delta', text: 'answer' },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(runAgent({ provider, messages, rootDir: '.' }));

    const reasoning = events.filter((e): e is Extract<AgentEvent, { type: 'reasoning_delta' }> => e.type === 'reasoning_delta');
    expect(reasoning.map((e) => e.text)).toEqual(['thinking ', 'hard']);
    // no trace of reasoning in the persisted log
    expect(JSON.stringify(messages)).not.toContain('thinking');
    expect(events.some((e) => e.type === 'text_delta' && e.text === 'answer')).toBe(true);
  });

  it('appends an interrupted-turn marker when the signal fires mid-stream', async () => {
    const controller = new AbortController();
    const provider: ChatProvider = {
      async *stream() {
        yield { type: 'text_delta', text: 'partial' };
        controller.abort();
        yield { type: 'text_delta', text: ' never consumed' };
      },
    };
    const messages: AgentMessage[] = [];
    const events = await collect(
      runAgent({ provider, messages, rootDir: '.', signal: controller.signal }),
    );

    expect(events.map((e) => e.type)).toEqual(['turn_start', 'text_delta', 'turn_aborted', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'aborted' });
    // partial assistant text is discarded; the marker is the only trace
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: TURN_ABORTED_GUIDANCE });
    const abortedEvent = events.find((e): e is Extract<AgentEvent, { type: 'turn_aborted' }> => e.type === 'turn_aborted');
    expect(abortedEvent?.message).toBe(messages[0]);
  });

  it('treats a provider AbortError as a user interruption', async () => {
    const controller = new AbortController();
    const provider: ChatProvider = {
      async *stream() {
        yield { type: 'text_delta', text: 'partial' };
        controller.abort();
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    };
    const messages: AgentMessage[] = [];
    const events = await collect(
      runAgent({ provider, messages, rootDir: '.', signal: controller.signal }),
    );

    expect(events.map((e) => e.type)).toEqual(['turn_start', 'text_delta', 'turn_aborted', 'done']);
    expect(messages.at(-1)).toMatchObject({ role: 'user', content: TURN_ABORTED_GUIDANCE });
  });

  it('records queued tool calls as not executed when aborted between tools', async () => {
    const controller = new AbortController();
    const abortingTool: ToolDefinition = {
      name: 'aborting',
      description: 'aborts the signal during execution',
      parameters: { type: 'object' },
      execute: () => {
        controller.abort();
        return 'ran';
      },
    };
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'c1', name: 'aborting', argsDelta: '{}' },
        { type: 'tool_call_delta', index: 1, id: 'c2', name: 'aborting', argsDelta: '{}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(
      runAgent({ provider, messages, rootDir: '.', tools: [abortingTool], signal: controller.signal }),
    );

    // every tool call keeps its required result message
    const toolResults = messages.filter((m): m is ToolResultMessage => m.role === 'tool');
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]).toMatchObject({ toolCallId: 'c1', content: 'ran' });
    expect(toolResults[1]).toMatchObject({
      toolCallId: 'c2',
      content: '[not executed: the user interrupted this turn]',
    });
    expect(messages.at(-1)).toMatchObject({ role: 'user', content: TURN_ABORTED_GUIDANCE });
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'aborted' });
  });
});

describe('runAgent parallel tool dispatch', () => {
  it('executes adjacent concurrency-safe calls in parallel, results in call order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tracker: ToolDefinition = {
      name: 'track',
      description: 'tracks overlap',
      parameters: { type: 'object' },
      execute: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return 'ok';
      },
      isConcurrencySafe: () => true,
    };
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'c1', name: 'track', argsDelta: '{}' },
        { type: 'tool_call_delta', index: 1, id: 'c2', name: 'track', argsDelta: '{}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(runAgent({ provider, messages, rootDir: '.', tools: [tracker] }));

    expect(maxInFlight).toBe(2);
    const results = events.filter((e) => e.type === 'tool_call_result');
    // results surface in original call order even though execution overlapped
    expect(results.map((e) => (e as { call: { id: string } }).call.id)).toEqual(['c1', 'c2']);
    // both starts precede the first result
    const firstResultIdx = events.findIndex((e) => e.type === 'tool_call_result');
    expect(events.slice(0, firstResultIdx).filter((e) => e.type === 'tool_call_start')).toHaveLength(2);
  });

  it('keeps unsafe tools strictly serial between safe ones', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const makeTool = (name: string, safe: boolean): ToolDefinition => ({
      name,
      description: name,
      parameters: { type: 'object' },
      execute: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return 'ok';
      },
      ...(safe ? { isConcurrencySafe: () => true } : {}),
    });
    const tools = [makeTool('safe1', true), makeTool('unsafe', false), makeTool('safe2', true)];
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'c1', name: 'safe1', argsDelta: '{}' },
        { type: 'tool_call_delta', index: 1, id: 'c2', name: 'unsafe', argsDelta: '{}' },
        { type: 'tool_call_delta', index: 2, id: 'c3', name: 'safe2', argsDelta: '{}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    await collect(runAgent({ provider, messages, rootDir: '.', tools }));

    expect(maxInFlight).toBe(1);
    expect(messages.filter((m) => m.role === 'tool')).toHaveLength(3);
  });
});

describe('runAgent tool timeout', () => {
  it('abandons a call that exceeds timeoutMs and keeps the loop alive', async () => {
    const slow: ToolDefinition = {
      name: 'slow',
      description: 'ignores its signal',
      parameters: { type: 'object' },
      execute: async (_args, c) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        void c;
        return 'finished late';
      },
      timeoutMs: 30,
    };
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'c1', name: 'slow', argsDelta: '{}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'recovered' }, { type: 'finish', finishReason: 'stop' }],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(runAgent({ provider, messages, rootDir: '.', tools: [slow] }));

    const result = messages.find((m): m is ToolResultMessage => m.role === 'tool');
    expect(result?.content).toContain('timed out after 30ms');
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'complete' });
  });
});

describe('length cutoff defense', () => {
  it('fails every tool call of a length-truncated message and lets the model re-issue', async () => {
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'call_1', name: 'get_time', argsDelta: '{"time' },
        { type: 'usage', usage: { promptTokens: 20, completionTokens: 8, cachedTokens: 0 } },
        { type: 'finish', finishReason: 'length' },
      ],
      [
        { type: 'text_delta', text: 'recovered' },
        { type: 'usage', usage: { promptTokens: 40, completionTokens: 6, cachedTokens: 0 } },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(runAgent({ provider, messages, rootDir: '.' }));

    const results = events.filter(
      (e): e is Extract<AgentEvent, { type: 'tool_call_result' }> => e.type === 'tool_call_result',
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.result.content).toContain(LENGTH_CUTOFF_TOOL_GUIDANCE);
    expect(results[0]?.result.content).toContain('get_time');
    // the failed result feeds back as a normal tool message, then the model retries
    expect(messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'complete' });
  });
});

describe('provider reset (mid-stream retry)', () => {
  it('rolls back accumulators and stats, then keeps only the replayed attempt', async () => {
    const provider = scriptedProvider([
      [
        { type: 'text_delta', text: 'par' },
        { type: 'usage', usage: { promptTokens: 100, completionTokens: 10, cachedTokens: 50 } },
        { type: 'reset', attempt: 1, maxRetries: 3, error: 'upstream dropped' },
        { type: 'text_delta', text: 'final' },
        { type: 'usage', usage: { promptTokens: 120, completionTokens: 6, cachedTokens: 100 } },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(runAgent({ provider, messages, rootDir: '.' }));

    const retry = events.find((e): e is Extract<AgentEvent, { type: 'llm_retry' }> => e.type === 'llm_retry');
    expect(retry).toMatchObject({ type: 'llm_retry', attempt: 1, maxRetries: 3, error: 'upstream dropped' });
    // the failed attempt's usage is rolled back out of the cumulative stats
    expect(retry?.stats.promptTokens).toBe(0);

    // the persisted assistant message carries ONLY the replayed attempt
    const assistant = messages.find((m): m is Extract<AgentMessage, { role: 'assistant' }> => m.role === 'assistant');
    expect(assistant?.content).toBe('final');
    expect(assistant?.usage).toEqual({ promptTokens: 120, completionTokens: 6, cachedTokens: 100 });

    const lastUsage = events
      .filter((e): e is Extract<AgentEvent, { type: 'usage' }> => e.type === 'usage')
      .at(-1);
    expect(lastUsage?.stats).toMatchObject({ promptTokens: 120, completionTokens: 6, cachedTokens: 100 });
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'complete' });
  });

  it('discards partial tool-call deltas from the failed attempt', async () => {
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'c_stale', name: 'get_time', argsDelta: '{"time' },
        { type: 'reset', attempt: 1, maxRetries: 3, error: 'upstream dropped' },
        { type: 'tool_call_delta', index: 0, id: 'c_fresh', name: 'get_time', argsDelta: '{}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [{ type: 'text_delta', text: 'ok' }, { type: 'finish', finishReason: 'stop' }],
    ]);
    const messages: AgentMessage[] = [];
    await collect(runAgent({ provider, messages, rootDir: '.', tools: [getTimeTool] }));

    const assistant = messages.find(
      (m): m is Extract<AgentMessage, { role: 'assistant' }> => m.role === 'assistant' && m.toolCalls !== undefined,
    );
    expect(assistant?.toolCalls?.[0]).toMatchObject({ id: 'c_fresh', args: {} });
    const toolResult = messages.find((m): m is Extract<AgentMessage, { role: 'tool' }> => m.role === 'tool');
    expect(toolResult?.toolCallId).toBe('c_fresh');
  });
});

describe('cache miss audit', () => {
  it('counts misses only after the provider reported cache activity and above the noise floor', async () => {
    const provider = scriptedProvider([
      [
        { type: 'tool_call_delta', index: 0, id: 'call_1', name: 'get_time', argsDelta: '{}' },
        { type: 'usage', usage: { promptTokens: 5000, completionTokens: 8, cachedTokens: 0 } },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [
        { type: 'tool_call_delta', index: 0, id: 'call_2', name: 'get_time', argsDelta: '{}' },
        { type: 'usage', usage: { promptTokens: 6000, completionTokens: 8, cachedTokens: 4000 } },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', text: 'ok' },
        { type: 'usage', usage: { promptTokens: 7000, completionTokens: 4, cachedTokens: 6500 } },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(runAgent({ provider, messages, rootDir: '.', tools: [getTimeTool] }));

    const lastUsage = events
      .filter((e): e is Extract<AgentEvent, { type: 'usage' }> => e.type === 'usage')
      .at(-1);
    // turn 1: provider reported no cache yet → miss not counted (sticky gate);
    // turn 2: miss 2000 > noise floor 1024 → counted;
    // turn 3: miss 500 below floor → not counted
    expect(lastUsage?.stats.missTokens).toBe(2000);
    expect(lastUsage?.stats.missTurns).toBe(1);
  });
});
