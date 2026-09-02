import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session, type AssistantMessage, type UserMessage } from '../src/index.js';

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
});
