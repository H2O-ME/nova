/**
 * The switchable live provider (the web surface's `llm` seam).
 *
 * The two properties a switch depends on:
 *
 *  - ONE instance: the kernel's `llm` service handed this object out, so a
 *    switch must move its TARGET, never replace the object — otherwise every
 *    session and nested subagent that captured the reference keeps talking to
 *    the previous endpoint while the UI claims the new one.
 *  - the first-run shell: boot installs a refusing placeholder (no client to
 *    build yet); the FIRST `setEndpoint` after a save must ask the shell's
 *    builder for a real client — exactly once under concurrency — and apply
 *    the endpoint to it. "Target has no `setEndpoint`" is the signal.
 */
import { describe, expect, it } from 'vitest';
import type { ChatProvider, ChatRequest } from '@nova-agent/core';
import { switchableProvider } from '../src/live-provider.js';

function recordingClient(): ChatProvider & {
  endpoints: Array<{ baseURL: string; apiKey: string; model: string }>;
  models: string[];
  streams: number;
} {
  const client = {
    endpoints: [] as Array<{ baseURL: string; apiKey: string; model: string }>,
    models: ['m1'] as string[],
    streams: 0,
    async *stream(_req: ChatRequest) {
      client.streams += 1;
      yield { type: 'finish', finishReason: 'stop' };
    },
    setEndpoint(endpoint: { baseURL: string; apiKey: string; model: string }): void {
      client.endpoints.push(endpoint);
    },
    async listModels(): Promise<string[]> {
      return client.models;
    },
    setModel(model: string): void {
      client.models = [model];
    },
  };
  return client;
}

/** A refusal-only stand-in: no `setEndpoint`, and streaming throws on first next(). */
function placeholder(): ChatProvider {
  return {
    // A generator with no yield is the point: the placeholder refuses before
    // any model call can stream.
    // oxlint-disable-next-line require-yield
    async *stream(): AsyncGenerator<never> {
      throw new Error('not configured');
    },
  };
}

const ENDPOINT = { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm1' };

describe('switchableProvider', () => {
  it('applies the first endpoint by building a real client from the shell (placeholder → real)', async () => {
    const built = recordingClient();
    let builds = 0;
    const live = switchableProvider(placeholder(), async () => {
      builds += 1;
      return built;
    });
    expect(live.isPlaceholder()).toBe(true);
    await live.setEndpoint(ENDPOINT);
    expect(built.endpoints).toEqual([ENDPOINT]);
    expect(builds).toBe(1);
    expect(live.isPlaceholder()).toBe(false);
  });

  it('builds EXACTLY ONCE under concurrent first switches', async () => {
    const built = recordingClient();
    let builds = 0;
    const live = switchableProvider(placeholder(), async () => {
      builds += 1;
      return built;
    });
    await Promise.all([
      live.setEndpoint(ENDPOINT),
      live.setEndpoint({ ...ENDPOINT, apiKey: 'sk-2' }),
    ]);
    expect(builds).toBe(1);
    // Both endpoints applied to the built client, in call order: the second
    // caller must not silently drop its switch behind the first one's build.
    expect(built.endpoints).toEqual([ENDPOINT, { ...ENDPOINT, apiKey: 'sk-2' }]);
  });

  it('delegates to the real target without rebuilding', async () => {
    const initial = recordingClient();
    const live = switchableProvider(initial, async () => {
      throw new Error('builder must not run once a real client is in force');
    });
    expect(live.isPlaceholder()).toBe(false);
    await live.setEndpoint(ENDPOINT);
    expect(initial.endpoints).toEqual([ENDPOINT]);
  });

  it('streams THROUGH the current target, read per call', async () => {
    const initial = recordingClient();
    const live = switchableProvider(initial, async () => {
      throw new Error('no rebuild expected');
    });
    const req = { messages: [] } as unknown as ChatRequest;
    for await (const _ of live.stream(req)) void _;
    expect(initial.streams).toBe(1);
  });

  it('forwards setModel and listModels to the live target', async () => {
    const initial = recordingClient();
    const live = switchableProvider(initial, async () => initial);
    live.setModel('m2');
    expect(initial.models).toEqual(['m2']);
    await expect(live.listModels(1_000)).resolves.toEqual(['m2']);
  });
});
