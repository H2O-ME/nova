import { mkdtemp, readFile, readdir } from 'node:fs/promises';
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
  selectRecentMessages,
  serializeConversationForSummary,
  serializeFullConversation,
  surfaceDivergence,
} from '../src/compact.js';
import { buildContextFragment, type SessionEnvInfo } from '../src/context.js';

const env: SessionEnvInfo = { platform: 'win32', cwd: 'D:\\w', shell: 'bash', today: '2026-08-31' };
const fragmentText = buildContextFragment(env, undefined, []);

function userMsg(content: string): UserMessage {
  return { id: `msg_${content.slice(0, 6)}_${Math.random().toString(36).slice(2, 8)}`, ts: 0, role: 'user', content };
}

/** Hermetic compactSession call: the transcript archive lands in the temp dir. */
async function compact(dir: string, opts: Omit<Parameters<typeof compactSession>[0], 'cacheDir'>) {
  return compactSession({ ...opts, cacheDir: path.join(dir, 'cache') });
}

function textProvider(text: string): ChatProvider {
  return {
    async *stream() {
      yield { type: 'text_delta', text };
      yield { type: 'finish', finishReason: 'stop' };
    },
  };
}

describe('selectRecentMessages', () => {
  it('keeps recent user messages AND pure-text assistant replies, drops fragments/summaries/abort markers', () => {
    const messages: AgentMessage[] = [
      userMsg(fragmentText),
      userMsg(TURN_ABORTED_GUIDANCE),
      userMsg(`${COMPACT_SUMMARY_PREFIX}\nold summary`),
      userMsg('帮我看看这个报错'),
      { id: 'a1', ts: 0, role: 'assistant', content: '好的，在查' },
      userMsg('继续修下一个'),
      { id: 'a2', ts: 0, role: 'assistant', content: '修完了' },
    ];
    const picked = selectRecentMessages(messages, 20_000);
    expect(picked.map((m) => m.content)).toEqual(['帮我看看这个报错', '好的，在查', '继续修下一个', '修完了']);
  });

  it('never keeps a tool-call assistant message alone (its results would be stranded)', () => {
    const messages: AgentMessage[] = [
      userMsg('do it'),
      {
        id: 'a1',
        ts: 0,
        role: 'assistant',
        content: 'working',
        toolCalls: [{ id: 'c1', name: 'bash', args: { cmd: 'ls' }, rawArgs: '{"cmd":"ls"}' }],
      },
      { id: 'a2', ts: 0, role: 'assistant', content: 'done, all green' },
    ];
    const picked = selectRecentMessages(messages, 20_000);
    // the tool-call message is skipped but does not stop the walk: the older
    // user request still fits and is kept
    expect(picked.map((m) => m.content)).toEqual(['do it', 'done, all green']);
    expect(picked.map((m) => m.id)).not.toContain('a1');
  });

  it('takes whole messages within the budget and stops at the first overflow', () => {
    const long = 'x'.repeat(30);
    const messages: AgentMessage[] = [userMsg(long), userMsg('short one')];
    // budget 12: 'short one' (9 chars) is kept; the older 30-char message
    // does not fit whole, so the walk stops — no truncated copies exist that
    // could rejoin the log projection verbatim.
    const picked = selectRecentMessages(messages, 12);
    expect(picked).toHaveLength(1);
    expect(picked[0]?.content).toBe('short one');
    // A budget large enough for both keeps them in original order.
    const both = selectRecentMessages(messages, 100);
    expect(both.map((m) => m.content)).toEqual([long, 'short one']);
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

    const outcome = await compact(dir, {
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
    // Summary body = model output + the archive pointer appended after it.
    expect(outcome.surface[3]).toMatchObject({ role: 'user' });
    expect((outcome.surface[3]!.content).startsWith(`${COMPACT_SUMMARY_PREFIX}\nGoal: fix tests.`)).toBe(true);
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

  it('archives the UNTRUNCATED transcript and references it from the summary', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    const long = 'e'.repeat(9000); // beyond SUMMARY_TOOL_RESULT_MAX_CHARS
    await session.append(userMsg('run it'));
    await session.append({
      id: 'a1',
      ts: 0,
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'bash', args: { cmd: 'make test' }, rawArgs: '{"cmd":"make test"}' }],
    });
    await session.append({ id: 't1', ts: 0, role: 'tool', toolCallId: 'c1', name: 'bash', content: long });

    const outcome = await compact(dir, { client: textProvider('summary'), session, messages: session.deriveMessages() });

    // the summary carries a machine-readable pointer to the archive
    const match = /<archive>(.+?)<\/archive>/.exec(outcome.summary);
    expect(match).not.toBeNull();
    const archivePath = match![1]!;
    expect(archivePath.startsWith(path.join(dir, 'cache'))).toBe(true);
    expect(outcome.archivePath).toBe(archivePath);
    // the archived transcript keeps the FULL tool output the summary input caps
    const archived = await readFile(archivePath, 'utf8');
    expect(archived).toContain(long);
    expect(archived).not.toContain('…[截断]');
    // summary-input serialization stays capped (the two serializers differ)
    expect(serializeConversationForSummary(session.allMessages())).not.toContain(long);
    expect(serializeFullConversation(session.allMessages())).toContain(long);
  });

  it('every retained message is itself on the surface (no identity-stranded picks)', async () => {
    // Regression for the truncated-copy bug: a spread-copied overflow message
    // failed the object-identity Map lookup and vanished from `keep` while
    // `retained` still counted it. Whole-message takes must always land.
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    const fragment = userMsg(fragmentText);
    const recent = userMsg('recent request');
    const overflow = userMsg('y'.repeat(50)); // older than the budget admits
    for (const msg of [fragment, overflow, recent]) await session.append(msg);

    const outcome = await compact(dir, {
      client: textProvider('summary'),
      session,
      messages: session.deriveMessages(),
      recentBudgetChars: recent.content.length, // only `recent` fits whole
    });
    expect(outcome.retained).toBe(1);
    const surfaceIds = new Set(outcome.surface.map((m) => m.id));
    const surfaceContents = outcome.surface.map((m) => m.content);
    expect(surfaceContents).toContain('recent request');
    expect(surfaceContents).not.toContain(overflow.content);
    // The picked message IS on the surface (id match), not a copy that was
    // dropped from `keep` after being counted.
    expect(surfaceIds.has(recent.id)).toBe(true);
  });

  it('keeps a placeholder line when the model returns an empty summary', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    const msg = userMsg('hi');
    await session.append(msg);
    const outcome = await compact(dir, { client: textProvider('   '), session, messages: [msg] });
    expect(outcome.summary.startsWith('(无摘要可用)')).toBe(true);
    expect(outcome.retained).toBe(1);
  });

  it('keeps raw history intact across two compactions and still projects correctly', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    const fragment = userMsg(fragmentText);
    await session.append(fragment);
    await session.append(userMsg('round one'));
    let surface = await compact(dir, { client: textProvider('summary 1'), session, messages: session.deriveMessages() });
    // continue working after compaction
    const followUp = userMsg('round two');
    await session.append(followUp);
    surface = await compact(dir, {
      client: textProvider('summary 2'),
      session,
      messages: [...surface.surface, followUp],
      trigger: 'auto',
    });

    expect(surface.surface[0]).toMatchObject({ content: fragmentText });
    expect(surface.surface[3]!.content.startsWith(`${COMPACT_SUMMARY_PREFIX}\nsummary 2`)).toBe(true);

    const reopened = await Session.open(session.file);
    expect(reopened.deriveMessages()).toEqual(surface.surface);
    // raw history is never rewritten: all messages remain in the log
    expect(reopened.allMessages()).toHaveLength(3);
  });

  it('chains the previous archive into the new summary on incremental compaction', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    await session.append(userMsg('round one'));
    const first = await compact(dir, { client: textProvider('summary 1'), session, messages: session.deriveMessages() });
    const firstArchive = /<archive>(.+?)<\/archive>/.exec(first.summary)?.[1];
    expect(firstArchive).toBeDefined();

    const followUp = userMsg('round two');
    await session.append(followUp);
    const second = await compact(dir, {
      client: textProvider('summary 2'),
      session,
      messages: [...first.surface, followUp],
      trigger: 'auto',
    });
    // the newest summary links BOTH the fresh archive and the older one
    expect(second.summary).toContain('<archive>');
    expect(second.summary).toContain(firstArchive!);
    const archives = readdir(path.join(dir, 'cache'));
    expect((await archives).length).toBe(2);
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
    const long = 'x'.repeat(5000);
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
    const first = await compact(dir, { client: textProvider('summary 1'), session, messages: session.deriveMessages() });
    const followUp = userMsg('round two');
    await session.append(followUp);
    const { provider, requests } = capturingProvider('summary 2');
    const second = await compact(dir, {
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
    expect(second.summary.startsWith('summary 2')).toBe(true);
  });

  it('streams summarizer deltas to the onDelta tap (tps metering)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-compact-'));
    const session = await Session.create(dir);
    await session.append(userMsg('hi'));
    const chunks: string[] = [];
    await compact(dir, {
      client: textProvider('summary text'),
      session,
      messages: session.deriveMessages(),
      onDelta: (text) => chunks.push(text),
    });
    expect(chunks).toEqual(['summary text']);
  });
});
