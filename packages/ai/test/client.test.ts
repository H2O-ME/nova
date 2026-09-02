import type { StreamEvent } from '@nova-agent/core';
import { describe, expect, it } from 'vitest';
import { OpenAICompatClient } from '../src/client.js';

const SSE_BODY = [
  'data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_time","arguments":""}}]},"index":0}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"index":0}]}',
  '',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}',
  '',
  'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":8}}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

function sseResponse(body: string, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

function clientWith(fetchImpl: typeof fetch): OpenAICompatClient {
  return new OpenAICompatClient({
    baseURL: 'https://example.test/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    fetchImpl,
    retryBaseDelayMs: 1,
  });
}

async function drain(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of stream) events.push(ev);
  return events;
}

describe('OpenAICompatClient', () => {
  it('translates SSE chunks into stream events including usage', async () => {
    const client = clientWith(() => Promise.resolve(sseResponse(SSE_BODY)));
    const events = await drain(client.stream({ messages: [] }));

    expect(events.some((e) => e.type === 'text_delta' && e.text === 'Hi')).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'tool_call_delta' && e.id === 'call_1' && e.name === 'get_time',
      ),
    ).toBe(true);
    const usage = events.find((e): e is Extract<StreamEvent, { type: 'usage' }> => e.type === 'usage');
    expect(usage?.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      cachedTokens: 8,
    });
    const finish = events.find((e): e is Extract<StreamEvent, { type: 'finish' }> => e.type === 'finish');
    expect(finish?.finishReason).toBe('tool_calls');
  });

  it('keeps the first tool-call id/name when later chunks repeat them as empty strings', async () => {
    const gatewayBody = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_time","arguments":""}}]},"index":0}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","type":"","function":{"name":"","arguments":"{\\"timezone\\": "}}]},"index":0}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","type":"","function":{"name":"","arguments":"\\"UTC\\"}"}}]},"index":0}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":4}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const client = clientWith(() => Promise.resolve(sseResponse(gatewayBody)));
    const events = await drain(client.stream({ messages: [] }));

    const nameDeltas = events
      .filter((e): e is Extract<StreamEvent, { type: 'tool_call_delta' }> => e.type === 'tool_call_delta')
      .filter((e) => e.name !== undefined);
    expect(nameDeltas).toHaveLength(1);
    expect(nameDeltas[0]?.name).toBe('get_time');
    expect(nameDeltas[0]?.id).toBe('call_abc');
  });

  it('translates reasoning_content deltas and passes max_tokens through', async () => {
    const reasoningBody = [
      'data: {"choices":[{"delta":{"reasoning_content":"step 1"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = (_input, init) => {
      capturedInit = init;
      return Promise.resolve(sseResponse(reasoningBody));
    };
    const client = clientWith(fetchImpl);
    const events = await drain(client.stream({ messages: [] }));

    expect(
      events.some((e) => e.type === 'reasoning_delta' && e.text === 'step 1'),
    ).toBe(true);
    expect(events.some((e) => e.type === 'text_delta' && e.text === 'answer')).toBe(true);

    const clientWithLimit = new OpenAICompatClient({
      baseURL: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      fetchImpl: (_input, init) => {
        capturedInit = init;
        return Promise.resolve(sseResponse('data: [DONE]\n\n'));
      },
      retryBaseDelayMs: 1,
      temperature: 0.3,
      maxTokens: 4096,
    });
    await drain(clientWithLimit.stream({ messages: [] }));
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body['max_tokens']).toBe(4096);
    expect(body['temperature']).toBe(0.3);
  });

  it('retries a 429 and then succeeds', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(new Response(null, { status: 429 }));
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    };
    const client = clientWith(fetchImpl);
    const events = await drain(client.stream({ messages: [] }));
    expect(calls).toBe(2);
    expect(events).toEqual([]);
  });

  it('throws HttpError on a terminal 400', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response('{"error":{"message":"bad request"}}', { status: 400 }));
    const client = clientWith(fetchImpl);
    await expect(drain(client.stream({ messages: [] }))).rejects.toThrow('HTTP 400');
  });

  it('maps internal messages and tools to the wire format', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    };
    const client = clientWith(fetchImpl);
    await drain(
      client.stream({
        systemPrompt: 'be brief',
        messages: [
          { id: 'm1', ts: 0, role: 'user', content: 'q' },
          {
            id: 'm2',
            ts: 0,
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c1', name: 't', args: {}, rawArgs: '' }],
          },
          { id: 'm3', ts: 0, role: 'tool', toolCallId: 'c1', name: 't', content: 'r' },
        ],
        tools: [{ name: 't', description: 'd', parameters: { type: 'object' }, execute: () => '' }],
      }),
    );

    expect(capturedUrl).toBe('https://example.test/v1/chat/completions');
    const body = JSON.parse(String(capturedInit?.body)) as {
      model: string;
      stream: boolean;
      messages: Array<Record<string, unknown>>;
      tools: Array<Record<string, unknown>>;
    };
    expect(body.model).toBe('test-model');
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'q' });
    expect(body.messages[2]?.['tool_calls']).toEqual([
      { id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } },
    ]);
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'r' });
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: { name: 't', description: 'd', parameters: { type: 'object' } },
    });
  });
});

describe('session cache routing', () => {
  it('sends prompt_cache_key and session affinity headers when sessionId is set', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = (_input, init) => {
      capturedInit = init;
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    };
    const longId = 'sess_abcdefghijklmnop'.repeat(4); // 84 chars, above the 64-char budget
    const client = new OpenAICompatClient({
      baseURL: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      sessionId: longId,
      fetchImpl,
    });
    await drain(client.stream({ messages: [] }));

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['x-session-id']).toBe(longId);
    expect(headers['x-client-request-id']).toBe(longId);
    expect(headers['x-session-affinity']).toBe(longId);
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body['prompt_cache_key']).toBe(longId.slice(0, 64));
  });

  it('omits cache routing entirely when sessionId is unset', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = (_input, init) => {
      capturedInit = init;
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    };
    const client = clientWith(fetchImpl);
    await drain(client.stream({ messages: [] }));

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['x-session-id']).toBeUndefined();
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body['prompt_cache_key']).toBeUndefined();
  });

  it('honors Retry-After from a 429 response before succeeding', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } }));
      }
      return Promise.resolve(sseResponse('data: [DONE]\n\n'));
    };
    const client = new OpenAICompatClient({
      baseURL: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      fetchImpl,
      // If the server hint were ignored, backoff would stall for ~5s here.
      retryBaseDelayMs: 5000,
    });
    const started = Date.now();
    await drain(client.stream({ messages: [] }));
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('listModels', () => {
  it('fetches GET /models, de-duplicates and sorts ids', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'z-model' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const client = new OpenAICompatClient({
      baseURL: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      fetchImpl,
    });
    await expect(client.listModels()).resolves.toEqual(['a-model', 'z-model']);
    expect(capturedUrl).toBe('https://example.test/v1/models');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
  });

  it('throws HttpError with the body excerpt on failure', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response('forbidden', { status: 401, headers: {} }));
    const client = new OpenAICompatClient({
      baseURL: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      fetchImpl,
    });
    await expect(client.listModels()).rejects.toThrow('HTTP 401');
  });
});
