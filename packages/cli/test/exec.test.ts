import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session, type ChatRequest, type StreamEvent } from '@nova-agent/core';
import { runExec } from '../src/exec.js';
import { sessionDateBucket, type Config } from '../src/config.js';
import { scriptedProvider } from './helpers/scripted-provider.js';
import { withFakeHome } from './helpers/with-fake-home.js';

const config: Config = {
  provider: { baseURL: 'https://unused.example.com/v1', apiKey: 'sk-test', model: 'test-model' },
};

const TEXT_ONLY: StreamEvent[] = [
  { type: 'text_delta', text: 'Hello from Nova' },
  { type: 'usage', usage: { promptTokens: 12, completionTokens: 4, cachedTokens: 10 } },
  { type: 'finish', finishReason: 'stop' },
];

describe('runExec', () => {
  it('emits JSONL events and persists fragment + prompt + assistant reply under ~/.nova/sessions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    await withFakeHome(async (home) => {
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
      // 内核流的 JSON 面 = KernelEvent 全量（phase 换帧行、run_stats 统计行都是新增成员，
      // additive）；AgentEvent 子序列的序与形不变——消费者按 type 过滤即可。
      expect(events.filter((e) => e.type !== 'phase' && e.type !== 'run_stats').map((e) => e.type)).toEqual([
        'user_message',
        'turn_start',
        'text_delta',
        'usage',
        'message',
        'done',
      ]);
      // 统计行跟在 done 之后（CI 消费者可直接读耗时/吞吐）。
      expect(events.find((e) => e.type === 'run_stats')).toMatchObject({ stats: { requests: 1 } });
      expect(events.at(-1)).toMatchObject({ type: 'phase', phase: 'idle' });
      expect(events.find((e) => e.type === 'done')).toMatchObject({ type: 'done', stopReason: 'complete' });

      const sessionsDir = path.join(home, '.nova', 'sessions', sessionDateBucket());
      const files = await readdir(sessionsDir);
      const replayed = await Session.replay(path.join(sessionsDir, files[0]!));
      expect(replayed.messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
      expect(replayed.messages[0]).toMatchObject({ role: 'user', content: expect.stringContaining('<environment>') });
      expect(replayed.messages[2]).toMatchObject({ role: 'assistant', content: 'Hello from Nova' });
    });
  });

  it('auto-denies execute tools in non-interactive mode and streams human output', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    const out: string[] = [];
    // Isolated home like its siblings: a runExec writes a session log, and the
    // sessions root is global — without this the run lands in the real ~/.nova
    // and shows up in the user's own session list as a `nova-exec-…` workspace.
    await withFakeHome(async () => {
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
    });
    const text = out.join('');
    expect(text).toContain('run echo for me');
    expect(text).toContain('Permission denied');
    expect(text).toContain('cannot run commands here');
    expect(text).toContain('完成');
    expect(text).toContain('缓存 80%');
  });

  it('auto-compacts once when over the limit, then fuses when the retained floor stays over it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    await withFakeHome(async (home) => {
      // ~10k tokens by the 4-chars-per-token heuristic: over the 1000-token
      // test limit. Compaction keeps fragment + the 20k-char-capped prompt +
      // summary, so the post-compaction image stays above the limit — the
      // second pre-flight must FUSE (no more summarizer requests) instead of
      // compacting every turn.
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
          // turn 2: final answer — NO second summary request: the fuse held.
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

      // Call order: [summary1, turn1, turn2] — exactly one compaction request.
      expect(requests).toHaveLength(3);
      // The summary request is one tool-less user message.
      expect(requests[0]!.messages).toHaveLength(1);
      expect(requests[0]!.messages[0]).toMatchObject({ role: 'user' });
      // The turn requests go out with the compacted surface: fragment first,
      // synthesized summary message in place of the raw history.
      for (const idx of [1, 2] as const) {
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

      // The session log carries exactly one replayable compaction triple, not
      // one per turn; the projected surface ends with the final answer.
      const sessionsDir = path.join(home, '.nova', 'sessions', sessionDateBucket());
      const files = await readdir(sessionsDir);
      const session = await Session.open(path.join(sessionsDir, files[0]!));
      const types = session.events.map((e) => e.type);
      expect(types.filter((t) => t === 'compaction/start')).toHaveLength(1);
      expect(types).toContain('compaction/summary');
      expect(types.filter((t) => t === 'compaction/end')).toHaveLength(1);
      const surface = session.deriveMessages();
      expect(surface.at(-1)).toMatchObject({ role: 'assistant', content: 'done compacted' });
    });
  });

  it('surfaces the compaction fuse warning once in human mode', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-exec-'));
    await withFakeHome(async () => {
      const out: string[] = [];
      await runExec({
        rootDir: root,
        config: { ...config, autoCompactTokenLimit: 1000 },
        prompt: 'y'.repeat(40_000),
        json: false,
        provider: scriptedProvider([
          [{ type: 'text_delta', text: '摘要' }, { type: 'finish', finishReason: 'stop' }],
          [{ type: 'text_delta', text: 'done' }, { type: 'finish', finishReason: 'stop' }],
        ]),
        out: (text) => out.push(text),
      });
      const text = out.join('');
      expect(text).toContain('已自动压缩上下文');
      // Fuse line: compaction stopped because the retained floor itself exceeds
      // the limit — and it must appear exactly once, not per turn.
      expect(text.match(/停用自动压缩/g)).toHaveLength(1);
    });
  });
});
