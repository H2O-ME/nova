import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session, SessionListing, type AssistantMessage, type UserMessage } from '../src/index.js';

function user(id: string, content: string): UserMessage {
  return { id, ts: 1, role: 'user', content };
}

function assistant(id: string, content: string): AssistantMessage {
  return { id, ts: 2, role: 'assistant', content, usage: { promptTokens: 1, completionTokens: 2, cachedTokens: 0 } };
}

function userMessage(content: string): UserMessage {
  return { id: `u_${content.length}`, ts: 1, role: 'user', content };
}

describe('Session', () => {
  it('appends and replays messages as an exact round trip', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-sess-'));
    const session = await Session.create(dir, 'sess_test');
    const user: UserMessage = { id: 'msg_u1', ts: 1, role: 'user', content: 'hi' };
    const assistant: AssistantMessage = {
      id: 'msg_a1',
      ts: 2,
      role: 'assistant',
      content: 'hello',
      usage: { promptTokens: 1, completionTokens: 2, cachedTokens: 0 },
    };
    await session.append(user);
    await session.append(assistant);

    const { header, messages } = await Session.replay(session.file);
    expect(header.id).toBe('sess_test');
    expect(header.type).toBe('session');
    expect(messages).toEqual([user, assistant]);

    const reopened = await Session.open(session.file);
    expect(reopened.id).toBe('sess_test');
  });

  it('rejects a file that is not a session log', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-sess-'));
    const file = path.join(dir, 'bad.jsonl');
    await writeFile(file, '{"type":"other"}\n', 'utf8');
    await expect(Session.replay(file)).rejects.toThrow('not a session file');
  });

  it('repairs a truncated trailing line (crash mid-append) and keeps the log clean', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-sess-'));
    const session = await Session.create(dir, 'sess_crash');
    const first = user('msg_u1', 'hi');
    const second = assistant('msg_a1', 'hello');
    await session.append(first);
    await session.append(second);

    // Simulate a crash between write() and the trailing newline: the last
    // line is a partial JSON fragment.
    const raw = await readFile(session.file, 'utf8');
    await writeFile(session.file, `${raw}{"type":"mess`, 'utf8');

    const reopened = await Session.open(session.file);
    expect(reopened.warnings).toEqual([]); // tail repair is silent — not corruption
    expect(reopened.allMessages()).toEqual([first, second]);

    // Appends continue cleanly after the repair; the log stays parseable.
    const third = assistant('msg_a2', 'again');
    await reopened.append(third);
    const thrice = await Session.open(session.file);
    expect(thrice.allMessages()).toEqual([first, second, third]);
    for (const line of (await readFile(session.file, 'utf8')).trimEnd().split('\n')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('skips a corrupt middle line with a warning instead of failing the open', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-sess-'));
    const session = await Session.create(dir, 'sess_bad');
    const first = user('msg_u1', 'hi');
    await session.append(first);

    // Plant real corruption in the middle of the file (not a truncation).
    const raw = await readFile(session.file, 'utf8');
    const lines = raw.trimEnd().split('\n');
    lines.splice(2, 0, 'not json at all');
    await writeFile(session.file, `${lines.join('\n')}\n`, 'utf8');

    const reopened = await Session.open(session.file);
    expect(reopened.warnings).toEqual([expect.stringContaining('损坏')]);
    expect(reopened.allMessages()).toEqual([first]);
  });

  it('normalizes a missing trailing newline so appends cannot glue lines', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-sess-'));
    const session = await Session.create(dir, 'sess_glue');
    const first = user('msg_u1', 'hi');
    await session.append(first);
    // External writer left no trailing newline after the last line.
    await writeFile(session.file, (await readFile(session.file, 'utf8')).trimEnd(), 'utf8');

    const reopened = await Session.open(session.file);
    await reopened.append(assistant('msg_a1', 'hello'));

    const thrice = await Session.open(session.file);
    expect(thrice.allMessages()).toHaveLength(2);
    for (const line of (await readFile(session.file, 'utf8')).trimEnd().split('\n')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe('compaction keepIds projection', () => {
  it('prefers keepIds over positional keep when both are present', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-sess-keep-'));
    const session = await Session.create(dir, 'sess_keep');
    const fragment = user('msg_ctx_frag', '<environment>\ncwd=/w\n</environment>');
    const recent = user('msg_recent', 'do the thing');
    await session.append(fragment);
    await session.append(recent);
    await session.append(assistant('msg_a1', 'ok'));

    // keep positions intentionally wrong (as corruption would shift them);
    // keepIds pin the actually-kept messages.
    await session.appendEvent({
      type: 'compaction/summary',
      summary: 'handoff',
      keep: [2],
      keepIds: ['msg_ctx_frag', 'msg_recent'],
      shadowedTokenCount: 10,
      at: 3,
    });

    const surface = session.deriveMessages();
    expect(surface.map((m) => m.id)).toEqual(['msg_ctx_frag', 'msg_recent', expect.stringMatching(/^msg_compact_/)]);
    expect(surface.at(-1)?.content).toContain('[已压缩的上一会话摘要]\nhandoff');
  });

  it('still resolves legacy logs by positional keep (no keepIds)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-sess-legacy-'));
    const session = await Session.create(dir, 'sess_legacy');
    await session.append(user('msg_u1', 'early'));
    await session.append(user('msg_u2', 'later'));
    await session.appendEvent({
      type: 'compaction/summary',
      summary: 'legacy handoff',
      keep: [0],
      shadowedTokenCount: 5,
      at: 3,
    });
    const surface = session.deriveMessages();
    expect(surface.map((m) => m.id)).toEqual(['msg_u1', expect.stringMatching(/^msg_compact_/)]);
  });
});

/**
 * The session list a surface keeps. Two rules matter to a sidebar: asking again
 * is cheap (the heads it read are remembered), and the answer is never stale
 * (a log that changed is re-read, and a session created a moment ago appears).
 */
describe('SessionListing', () => {
  it('re-reads only the logs whose mtime moved', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-list-'));
    // The listing walks the date-bucketed layout the CLI writes into.
    const bucket = path.join(root, '2026', '09', '24');
    const first = await Session.create(bucket, 'sess_a');
    const listing = new SessionListing(root);
    // A fresh log has a header and nothing else: no title, no workspace.
    expect((await listing.list(10))[0]).toMatchObject({ id: 'sess_a', title: '', workspace: undefined });

    // Asking again costs a walk plus one stat per log — nothing was re-peeked.
    expect((await listing.list(10)).map((e) => e.file)).toEqual([first.file]);

    // The log grew, so the mtime moved and the head is read again. The order is
    // the one the CLI writes: the workspace marker lands before the first prompt
    // (the peek stops at that prompt).
    await first.appendEvent({ type: 'workspace', path: 'D:/proj', at: 2 });
    await first.append(userMessage('first title'));
    await utimes(first.file, new Date(2_000), new Date(2_000));
    expect((await listing.list(10)).find((e) => e.id === 'sess_a')).toMatchObject({
      title: 'first title',
      workspace: 'D:/proj',
    });

    // A session created a moment ago shows up in the next answer: the list
    // itself is never cached (that is what a surface re-asks for).
    const second = await Session.create(bucket, 'sess_b');
    await second.append(userMessage('brand new'));
    expect((await listing.list(10)).map((e) => e.title)).toContain('brand new');
  });

  it('starts empty for a root that does not exist', async () => {
    const listing = new SessionListing(path.join(tmpdir(), 'nova-list-missing'));
    expect(await listing.list(5)).toEqual([]);
  });
});
