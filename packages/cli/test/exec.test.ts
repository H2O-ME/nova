import { readdir } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session, type ChatProvider, type StreamEvent } from '@nova-agent/core';
import { runExec } from '../src/exec.js';
import type { Config } from '../src/config.js';

const config: Config = {
  provider: { baseURL: 'https://unused.example.com/v1', apiKey: 'sk-test', model: 'test-model' },
};

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

const TEXT_ONLY: StreamEvent[] = [
  { type: 'text_delta', text: 'Hello from Nova' },
  { type: 'usage', usage: { promptTokens: 12, completionTokens: 4, cachedTokens: 10 } },
  { type: 'finish', finishReason: 'stop' },
];

describe('runExec', () => {
  it('emits JSONL events and persists fragment + prompt + assistant reply', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    const lines: string[] = [];
    await runExec({
      rootDir: root,
      config,
      prompt: '打个招呼',
      json: true,
      provider: scriptedProvider([TEXT_ONLY]),
      out: (text) => lines.push(text),
    });

    const events = lines.map((line) => JSON.parse(line) as { type: string });
    expect(events.map((e) => e.type)).toEqual(['turn_start', 'text_delta', 'usage', 'message', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'complete' });

    const files = await readdir(path.join(root, '.nova', 'sessions'));
    const replayed = await Session.replay(path.join(root, '.nova', 'sessions', files[0]!));
    expect(replayed.messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
    expect(replayed.messages[0]).toMatchObject({ role: 'user', content: expect.stringContaining('<environment>') });
    expect(replayed.messages[2]).toMatchObject({ role: 'assistant', content: 'Hello from Nova' });
  });

  it('auto-denies execute tools in non-interactive mode and streams human output', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    const out: string[] = [];
    await runExec({
      rootDir: root,
      config,
      prompt: 'run echo for me',
      json: false,
      provider: scriptedProvider([
        [
          { type: 'tool_call_delta', index: 0, id: 'c1', name: 'bash', argsDelta: '{"command":"echo hi"}' },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        [
          { type: 'usage', usage: { promptTokens: 30, completionTokens: 5, cachedTokens: 24 } },
          { type: 'text_delta', text: 'cannot run commands here' },
          { type: 'finish', finishReason: 'stop' },
        ],
      ]),
      out: (text) => out.push(text),
    });
    const text = out.join('');
    expect(text).toContain('run echo for me');
    expect(text).toContain('Permission denied');
    expect(text).toContain('cannot run commands here');
    expect(text).toContain('完成');
    expect(text).toContain('缓存 80%');
  });
});
