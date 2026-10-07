/**
 * The session-TITLE model is read per SESSION OPEN, not snapshotted at boot.
 *
 * The operator configures it from the settings page, which writes the config
 * file while the process runs — so a boot-time snapshot means a title model
 * chosen in a running `nova --web` (the same process that runs the QQ channel)
 * has no effect until a restart, and every conversation opened in between —
 * the QQ channel's included — stays untitled.
 *
 * Observable only end to end: the title client is built from the CONFIG FILE,
 * so the fake endpoint has to be a real one the loader can dial.
 */
import { createServer, type Server } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionsRoot, userConfigPath, type ChatProvider, type StreamEvent } from '@nova-agent/core';
import { loadConfigWithDiagnostics } from '../src/config.js';
import { bootKernel } from '../src/kernel-boot.js';

/** An endpoint that answers any request with one SSE-complete title. */
async function fakeEndpoint(): Promise<{ baseURL: string; close: () => void }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"标题甲"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { baseURL: `http://127.0.0.1:${port}/v1`, close: () => server.close() };
}

/** The chat side: one reply, no title involvement. */
const turn: ChatProvider = {
  model: 'm',
  async *stream(): AsyncGenerator<StreamEvent> {
    yield { type: 'text_delta', text: 'reply' };
    yield { type: 'finish', finishReason: 'stop' };
  },
};

/** Write the operator's config file (the temp home is the test's own). */
async function writeConfig(provider: { baseURL: string }, titleModel?: string): Promise<void> {
  await mkdir(path.dirname(userConfigPath()), { recursive: true });
  await writeFile(
    userConfigPath(),
    JSON.stringify({ provider: { ...provider, apiKey: 'k', model: 'm' }, ...(titleModel !== undefined ? { titleModel } : {}) }),
    'utf8',
  );
}

describe('session titles · the model is read per session open', () => {
  it('a title model configured after boot titles the next conversation', async () => {
    const endpoint = await fakeEndpoint();
    try {
      // Boot with NO title model — the state a first run is in.
      await writeConfig(endpoint);
      const { config } = await loadConfigWithDiagnostics();
      expect(config.titleModel).toBeUndefined();
      const kernel = await bootKernel({ rootDir: process.cwd(), config, provider: turn });
      try {
        // …then the operator picks one in the settings page, which is a config
        // write during the same process.
        await writeConfig(endpoint, 't');
        // A conversation opened from here on — the QQ channel's shape, its own
        // session bucket — must be titled.
        const agent = await kernel.newAgentSession({ sessionDir: path.join(sessionsRoot(), 'qqbot') });
        const titled: string[] = [];
        agent.subscribe((event) => {
          if (event.type === 'session_titled') titled.push(event.title);
        });
        await agent.prompt('hello there');
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(titled).toEqual(['标题甲']);
      } finally {
        await kernel.dispose();
      }
    } finally {
      endpoint.close();
    }
  });
});
