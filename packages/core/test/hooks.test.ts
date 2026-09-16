import { describe, expect, it } from 'vitest';
import { runAgent, type AgentEvent, type AgentMessage, type ChatRequest, type StreamEvent } from '../src/index.js';

function capturingProvider(onStream: (req: ChatRequest) => StreamEvent[]): {
  provider: { stream(req: ChatRequest): AsyncIterable<StreamEvent> };
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  return {
    requests,
    provider: {
      async *stream(req) {
        requests.push(req);
        for (const ev of onStream(req)) yield ev;
      },
    },
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe('runAgent hooks', () => {
  it('lets beforeLLMCall rewrite the request seen by the provider', async () => {
    const { provider, requests } = capturingProvider(() => [
      { type: 'text_delta', text: 'hi' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const messages: AgentMessage[] = [];
    await collect(
      runAgent({
        provider: provider as never,
        messages,
        rootDir: '.',
        systemPrompt: 'base',
        hooks: {
          beforeLLMCall: async (req) => ({ ...req, systemPrompt: 'rewritten' }),
        },
      }),
    );
    expect(requests[0]?.systemPrompt).toBe('rewritten');
  });

  it('deny verdict blocks execution and reports a permission-denied result', async () => {
    const { provider } = capturingProvider(() => [
      { type: 'tool_call_delta', index: 0, id: 'c1', name: 'danger', argsDelta: '{"x":1}' },
      { type: 'finish', finishReason: 'tool_calls' },
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(
      runAgent({
        provider: provider as never,
        messages,
        rootDir: '.',
        tools: [
          { name: 'danger', description: '', parameters: { type: 'object' }, execute: () => 'executed' },
        ],
        hooks: {
          beforeToolCall: async () => ({ action: 'deny', reason: 'policy' }),
        },
      }),
    );
    const toolResult = messages.find((m) => m.role === 'tool');
    expect(toolResult?.role === 'tool' && toolResult.content).toBe('Permission denied: policy');
    expect(events.some((e) => e.type === 'tool_call_result')).toBe(true);
  });

  it('rewrite verdict replaces executed arguments', async () => {
    const { provider } = capturingProvider(() => [
      { type: 'tool_call_delta', index: 0, id: 'c1', name: 't', argsDelta: '{"x":"bad"}' },
      { type: 'finish', finishReason: 'tool_calls' },
    ]);
    const messages: AgentMessage[] = [];
    const events = await collect(
      runAgent({
        provider: provider as never,
        messages,
        rootDir: '.',
        tools: [
          { name: 't', description: '', parameters: { type: 'object' }, execute: (args) => `ran:${String(args['x'])}` },
        ],
        hooks: {
          beforeToolCall: async () => ({ action: 'rewrite', args: { x: 'good' } }),
        },
      }),
    );
    const toolResult = messages.find((m) => m.role === 'tool');
    expect(toolResult?.role === 'tool' && toolResult.content).toBe('ran:good');
    // The assistant message keeps the model's original emission (append-only
    // log is never rewritten); the executed args live on the result event.
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.role === 'assistant' && assistant.toolCalls?.[0]?.rawArgs).toBe('{"x":"bad"}');
    const resultEvent = events.find(
      (e): e is Extract<AgentEvent, { type: 'tool_call_result' }> => e.type === 'tool_call_result',
    );
    expect(resultEvent?.call.rawArgs).toBe('{"x":"good"}');
  });

  it('fails closed on a malformed hook verdict instead of executing', async () => {
    // A hand-rolled AgentHooks bypasses the host composer — the loop's own
    // validation is the second net. `{ action: 'rewrite' }` without args
    // would previously have fallen through as allow and executed the
    // ORIGINAL args on a guess; now it denies with an actionable reason.
    const { provider } = capturingProvider(() => [
      { type: 'tool_call_delta', index: 0, id: 'c1', name: 't', argsDelta: '{"x":1}' },
      { type: 'finish', finishReason: 'tool_calls' },
    ]);
    const messages: AgentMessage[] = [];
    await collect(
      runAgent({
        provider: provider as never,
        messages,
        rootDir: '.',
        tools: [
          { name: 't', description: '', parameters: { type: 'object' }, execute: () => 'executed' },
        ],
        hooks: {
          beforeToolCall: (async () => ({ action: 'rewrite' })) as never,
        },
      }),
    );
    const toolResult = messages.find((m) => m.role === 'tool');
    expect(toolResult?.role === 'tool' && toolResult.content).toContain('malformed hook verdict');
    expect(toolResult?.role === 'tool' && toolResult.content).not.toContain('executed');
  });

  it('afterToolResult transforms the stored tool output', async () => {
    const { provider } = capturingProvider(() => [
      { type: 'tool_call_delta', index: 0, id: 'c1', name: 't', argsDelta: '{}' },
      { type: 'finish', finishReason: 'tool_calls' },
    ]);
    const messages: AgentMessage[] = [];
    await collect(
      runAgent({
        provider: provider as never,
        messages,
        rootDir: '.',
        tools: [
          { name: 't', description: '', parameters: { type: 'object' }, execute: () => 'raw' },
        ],
        hooks: {
          afterToolResult: async (_call, result) => `<wrapped>${result}</wrapped>`,
        },
      }),
    );
    const toolResult = messages.find((m) => m.role === 'tool');
    expect(toolResult?.role === 'tool' && toolResult.content).toBe('<wrapped>raw</wrapped>');
  });
});
