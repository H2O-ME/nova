import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session, type ChatProvider, type StreamEvent } from '@nova-agent/core';
import { runExec } from '../src/exec.js';
import { sessionDateBucket, type Config } from '../src/config.js';

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
  it('emits JSONL events and persists fragment + prompt + assistant reply under ~/.nova/sessions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    const home = await mkdtemp(path.join(tmpdir(), 'nova-home-'));
    // os.homedir() re-reads these per call on each platform, so runExec's
    // sessions root lands in the isolated fake home, never the real ~/.nova.
    const prevProfile = process.env['USERPROFILE'];
    const prevHome = process.env['HOME'];
    process.env['USERPROFILE'] = home;
    process.env['HOME'] = home;
    try {
      const lines: string[] = [];
      await runExec({
        rootDir: root,
        config,
        prompt: '打个招呼',
        json: true,
        // Auto discovery would ascend from %TEMP% (which lives under the user
        // profile on Windows) into the machine's real ~/.nova/mcp.json and
        // connect to its remote servers — network-dependent and slow.
        mcpConfigFile: null,
        provider: scriptedProvider([TEXT_ONLY]),
        out: (text) => lines.push(text),
      });

      const events = lines.map((line) => JSON.parse(line) as { type: string });
      expect(events.map((e) => e.type)).toEqual(['turn_start', 'text_delta', 'usage', 'message', 'done']);
      expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'complete' });

      const sessionsDir = path.join(home, '.nova', 'sessions', sessionDateBucket());
      const files = await readdir(sessionsDir);
      const replayed = await Session.replay(path.join(sessionsDir, files[0]!));
      expect(replayed.messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
      expect(replayed.messages[0]).toMatchObject({ role: 'user', content: expect.stringContaining('<environment>') });
      expect(replayed.messages[2]).toMatchObject({ role: 'assistant', content: 'Hello from Nova' });
    } finally {
      if (prevProfile === undefined) delete process.env['USERPROFILE'];
      else process.env['USERPROFILE'] = prevProfile;
      if (prevHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = prevHome;
    }
  });

  it('auto-denies execute tools in non-interactive mode and streams human output', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    const out: string[] = [];
    await runExec({
      rootDir: root,
      config,
      prompt: 'run echo for me',
      json: false,
      mcpConfigFile: null, // never touch the machine's real ~/.nova/mcp.json
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
