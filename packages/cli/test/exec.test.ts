import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session, type ChatProvider, type ChatRequest, type StreamEvent } from '@nova-agent/core';
import { runExec } from '../src/exec.js';
import { sessionDateBucket, type Config } from '../src/config.js';

const config: Config = {
  provider: { baseURL: 'https://unused.example.com/v1', apiKey: 'sk-test', model: 'test-model' },
};

function scriptedProvider(scripts: StreamEvent[][], capture?: ChatRequest[]): ChatProvider {
  let call = 0;
  return {
    async *stream(req: ChatRequest) {
      capture?.push(req);
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

  it('auto-compacts mid-run when the request image exceeds the limit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    const home = await mkdtemp(path.join(tmpdir(), 'nova-home-'));
    const prevProfile = process.env['USERPROFILE'];
    const prevHome = process.env['HOME'];
    process.env['USERPROFILE'] = home;
    process.env['HOME'] = home;
    try {
      // ~10k tokens by the 4-chars-per-token heuristic: over the 1000-token
      // test limit on every request, so every turn's pre-flight compacts.
      const bigPrompt = 'y'.repeat(40_000);
      const requests: ChatRequest[] = [];
      const provider = scriptedProvider(
        [
          // compaction summary request of the FIRST turn's pre-flight
          [{ type: 'text_delta', text: '已完成前置工作' }, { type: 'finish', finishReason: 'stop' }],
          // turn 1: a denied bash call forces a second turn
          [
            { type: 'tool_call_delta', index: 0, id: 'c1', name: 'bash', argsDelta: '{"command":"echo hi"}' },
            { type: 'finish', finishReason: 'tool_calls' },
          ],
          // compaction summary request of the SECOND turn's pre-flight
          [{ type: 'text_delta', text: '追加进度' }, { type: 'finish', finishReason: 'stop' }],
          // turn 2: final answer
          [
            { type: 'usage', usage: { promptTokens: 5, completionTokens: 3, cachedTokens: 2 } },
            { type: 'text_delta', text: 'done compacted' },
            { type: 'finish', finishReason: 'stop' },
          ],
        ],
        requests,
      );
      await runExec({
        rootDir: root,
        config: { ...config, autoCompactTokenLimit: 1000 },
        prompt: bigPrompt,
        json: true,
        provider,
        out: () => {},
      });

      // Call order: [summary1, turn1, summary2, turn2].
      expect(requests).toHaveLength(4);
      // The summary request is one tool-less user message.
      expect(requests[0]!.messages).toHaveLength(1);
      expect(requests[0]!.messages[0]).toMatchObject({ role: 'user' });
      // The turn requests go out with the compacted surface: fragment first,
      // synthesized summary message in place of the raw history.
      for (const idx of [1, 3] as const) {
        expect(requests[idx]!.messages[0]).toMatchObject({
          role: 'user',
          content: expect.stringContaining('<environment>'),
        });
        expect(
          requests[idx]!.messages.some(
            (m) => m.role === 'user' && m.content.startsWith('[已压缩的上一会话摘要]'),
          ),
        ).toBe(true);
      }

      // The session log carries the compaction events and stays replayable;
      // the projected surface ends with the final answer.
      const sessionsDir = path.join(home, '.nova', 'sessions', sessionDateBucket());
      const files = await readdir(sessionsDir);
      const session = await Session.open(path.join(sessionsDir, files[0]!));
      const types = session.events.map((e) => e.type);
      expect(types).toContain('compaction/start');
      expect(types).toContain('compaction/summary');
      expect(types).toContain('compaction/end');
      const surface = session.deriveMessages();
      expect(surface.at(-1)).toMatchObject({ role: 'assistant', content: 'done compacted' });
    } finally {
      if (prevProfile === undefined) delete process.env['USERPROFILE'];
      else process.env['USERPROFILE'] = prevProfile;
      if (prevHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = prevHome;
    }
  });
});
