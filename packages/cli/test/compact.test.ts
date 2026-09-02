import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPACT_SUMMARY_PREFIX,
  Session,
  TURN_ABORTED_GUIDANCE,
  type AgentMessage,
  type ChatProvider,
  type ChatRequest,
  type UserMessage,
} from '@nova-agent/core';
import {
  compactSession,
  isCompactSummary,
  selectRecentUserMessages,
  serializeConversationForSummary,
  surfaceDivergence,
} from '../src/compact.js';
import { buildContextFragment, type SessionEnvInfo } from '../src/context.js';

const env: SessionEnvInfo = { platform: 'win32', cwd: 'D:\\w', shell: 'bash', today: '2026-08-31' };
const fragmentText = buildContextFragment(env, undefined, []);

function userMsg(content: string): UserMessage {
  return { id: `msg_${content.slice(0, 6)}_${Math.random().toString(36).slice(2, 8)}`, ts: 0, role: 'user', content };
}

function textProvider(text: string): ChatProvider {
  return {
    async *stream() {
      yield { type: 'text_delta', text };
      yield { type: 'finish', finishReason: 'stop' };
    },
  };
}

describe('selectRecentUserMessages', () => {
  it('keeps recent user messages but drops fragments, summaries and abort markers', () => {
    const messages: AgentMessage[] = [
      userMsg(fragmentText),
      userMsg(TURN_ABORTED_GUIDANCE),
      userMsg(`${COMPACT_SUMMARY_PREFIX}\nold summary`),
      userMsg('帮我看看这个报错'),
      { id: 'a1', ts: 0, role: 'assistant', content: '好的' },
      userMsg('继续修下一个'),
    ];
    const picked = selectRecentUserMessages(messages, 20_000);
    expect(picked.map((m) => m.content)).toEqual(['帮我看看这个报错', '继续修下一个']);
  });

  it('truncates the oldest overflow message within the char budget', () => {
    const long = 'x'.repeat(30);
    const messages: AgentMessage[] = [userMsg(long), userMsg('short one')];
    // budget 12: 'short one' (9 chars) is kept first, leaving 3 chars for the older message
    const picked = selectRecentUserMessages(messages, 12);
    expect(picked).toHaveLength(2);
    expect(picked[1]?.content).toBe('short one');
    expect(picked[0]?.content).toBe('xxx…[截断]');
  });
});

describe('compactSession (in place)', () => {
  it('appends compaction events and projects fragment + recents + summary', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    const fragment = userMsg(fragmentText);
    const first = userMsg('first request');
    const second = userMsg('second request');
    for (const msg of [fragment, first, second]) await session.append(msg);
    const messages = session.deriveMessages();

    const outcome = await compactSession({
      client: textProvider('Goal: fix tests.'),
      session,
      messages,
      trigger: 'manual',
    });

    expect(outcome.retained).toBe(2);
    expect(outcome.surface).toHaveLength(4);
    expect(outcome.surface[0]).toMatchObject({ role: 'user', content: fragmentText });
    expect(outcome.surface[1]).toMatchObject({ role: 'user', content: 'first request' });
    expect(outcome.surface[2]).toMatchObject({ role: 'user', content: 'second request' });
    expect(outcome.surface[3]).toMatchObject({
      role: 'user',
      content: `${COMPACT_SUMMARY_PREFIX}\nGoal: fix tests.`,
    });
    expect(isCompactSummary(outcome.surface[3]!)).toBe(true);

    // compaction happened IN PLACE: same file, same id, three events appended
    expect(session.file.endsWith('.jsonl')).toBe(true);
    const types = session.events.map((evt) => evt.type);
    expect(types.slice(-3)).toEqual(['compaction/start', 'compaction/summary', 'compaction/end']);
    expect(session.hasOpenCompaction).toBe(false);

    // the log projects to exactly the new surface, byte-for-byte, after reopen
    const reopened = await Session.open(session.file);
    expect(reopened.deriveMessages()).toEqual(outcome.surface);
    expect(surfaceDivergence(reopened, outcome.surface)).toBeUndefined();
  });

  it('keeps a placeholder line when the model returns an empty summary', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    const msg = userMsg('hi');
    await session.append(msg);
    const outcome = await compactSession({ client: textProvider('   '), session, messages: [msg] });
    expect(outcome.summary).toBe('(无摘要可用)');
    expect(outcome.retained).toBe(1);
  });

  it('keeps raw history intact across two compactions and still projects correctly', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    const fragment = userMsg(fragmentText);
    await session.append(fragment);
    await session.append(userMsg('round one'));
    let surface = await compactSession({ client: textProvider('summary 1'), session, messages: session.deriveMessages() });
    // continue working after compaction
    const followUp = userMsg('round two');
    await session.append(followUp);
    surface = await compactSession({
      client: textProvider('summary 2'),
      session,
      messages: [...surface.surface, followUp],
      trigger: 'auto',
    });

    expect(surface.surface[0]).toMatchObject({ content: fragmentText });
    expect(surface.surface[3]).toMatchObject({ content: `${COMPACT_SUMMARY_PREFIX}\nsummary 2` });

    const reopened = await Session.open(session.file);
    expect(reopened.deriveMessages()).toEqual(surface.surface);
    // raw history is never rewritten: all messages remain in the log
    expect(reopened.allMessages()).toHaveLength(3);
  });
});

describe('orphaned compaction lock', () => {
  it('discards an incomplete compaction and warns on open', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    const fragment = userMsg(fragmentText);
    const msg = userMsg('real message');
    await session.append(fragment);
    await session.append(msg);
    await session.appendEvent({ type: 'compaction/start', trigger: 'auto', at: Date.now() });
    // crash before compaction/summary: the log keeps a dangling start

    const reopened = await Session.open(session.file);
    expect(reopened.hasOpenCompaction).toBe(true);
    expect(reopened.warnings.length).toBeGreaterThan(0);
    // projection ignores the incomplete attempt: full history stays intact
    expect(reopened.deriveMessages()).toEqual([fragment, msg]);
  });
});

function capturingProvider(text: string): { provider: ChatProvider; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    provider: {
      async *stream(req) {
        requests.push(req);
        yield { type: 'text_delta', text };
        yield { type: 'finish', finishReason: 'stop' };
      },
    },
  };
}

describe('serializeConversationForSummary', () => {
  it('caps tool results, keeps tool calls, and drops fragments and old summaries', () => {
    const long = 'x'.repeat(3000);
    const messages: AgentMessage[] = [
      userMsg(fragmentText),
      userMsg(`${COMPACT_SUMMARY_PREFIX}\nold summary`),
      userMsg('do it'),
      {
        id: 'a1',
        ts: 0,
        role: 'assistant',
        content: 'working on it',
        toolCalls: [{ id: 'c1', name: 'bash', args: { cmd: 'ls' }, rawArgs: '{"cmd":"ls"}' }],
      },
      { id: 't1', ts: 0, role: 'tool', toolCallId: 'c1', name: 'bash', content: long },
    ];
    const text = serializeConversationForSummary(messages);
    expect(text).toContain('[User]: do it');
    expect(text).toContain('[Assistant]: working on it');
    expect(text).toContain('[Assistant tool calls]: bash({"cmd":"ls"})');
    expect(text).toContain('…[截断]');
    expect(text).not.toContain(`${COMPACT_SUMMARY_PREFIX}\nold summary`);
    expect(text).not.toContain(long);
    expect(text).not.toContain(fragmentText);
  });
});

describe('incremental compaction', () => {
  it('merges into the previous summary instead of re-summarizing from scratch', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    await session.append(userMsg('round one'));
    const first = await compactSession({
      client: textProvider('summary 1'),
      session,
      messages: session.deriveMessages(),
    });
    const followUp = userMsg('round two');
    await session.append(followUp);
    const { provider, requests } = capturingProvider('summary 2');
    const second = await compactSession({
      client: provider,
      session,
      messages: [...first.surface, followUp],
      trigger: 'auto',
    });

    expect(requests).toHaveLength(1);
    const content = (requests[0]?.messages[0] as UserMessage | undefined)?.content ?? '';
    expect(content).toContain('INCREMENTAL CONTEXT CHECKPOINT UPDATE');
    expect(content).toContain('<previous_summary>\nsummary 1\n</previous_summary>');
    expect(content).toContain('[User]: round two');
    // the old summary message is embedded in the ask, not duplicated as history
    expect(content).not.toContain(COMPACT_SUMMARY_PREFIX);
    expect(second.summary).toBe('summary 2');
  });
});
