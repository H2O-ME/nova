import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Session } from '@nova-agent/core';
import { listRecentSessions, recordSessionWorkspace, sessionWorkspace } from '../src/sessions.js';

const writeSession = async (
  file: string,
  messages: Array<{ role: string; content: string }>,
  mtime: number,
): Promise<void> => {
  const header = `${JSON.stringify({ type: 'session', v: 2, id: path.basename(file, '.jsonl'), createdAt: mtime })}\n`;
  const events = messages.map((m, i) =>
    JSON.stringify({ type: 'message', message: { id: `m${i}`, ts: mtime, role: m.role, content: m.content } }),
  );
  await writeFile(file, `${header}${events.join('\n')}\n`, 'utf8');
  await utimes(file, new Date(mtime), new Date(mtime));
};

describe('listRecentSessions', () => {
  it('lists sessions newest-first and peeks the first real user prompt as title', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-sessions-'));
    const dirA = path.join(root, '2026', '09', '05');
    const dirB = path.join(root, '2026', '09', '06');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    const older = Date.parse('2026-09-05T10:00:00Z');
    const newer = Date.parse('2026-09-06T09:30:00Z');
    await writeSession(path.join(dirA, 'sess_a.jsonl'), [
      { role: 'user', content: '<environment>\npc=D:\\x\n</environment>' },
      { role: 'user', content: '帮我把图片统一格式\n第二行不该出现' },
      { role: 'assistant', content: '好的' },
    ], older);
    await writeSession(path.join(dirB, 'sess_b.jsonl'), [
      { role: 'user', content: '<environment>...</environment>' },
      { role: 'user', content: '写一个爬虫脚本' },
    ], newer);
    await writeFile(path.join(dirB, 'notes.txt'), 'not a session', 'utf8');

    const entries = await listRecentSessions(root, 10);
    expect(entries.map((e) => e.id)).toEqual(['sess_b', 'sess_a']);
    expect(entries[0]?.title).toBe('写一个爬虫脚本');
    // environment fragments are skipped, only the first line is kept
    expect(entries[1]?.title).toBe('帮我把图片统一格式');
    expect(entries[0]?.createdAt).toBe(newer);
    expect(entries[1]?.createdAt).toBe(older);

    expect((await listRecentSessions(root, 1)).map((e) => e.id)).toEqual(['sess_b']);
  });

  it('tolerates a truncated trailing line and a missing root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-sessions-'));
    const dir = path.join(root, '2026', '09', '06');
    await mkdir(dir, { recursive: true });
    const partial =
      `${JSON.stringify({ type: 'session', v: 2, id: 'sess_c', createdAt: 1 })}\n` +
      `${JSON.stringify({ type: 'message', message: { id: 'm0', ts: 1, role: 'user', content: '你好' } })}\n` +
      '{"type":"mess';
    await writeFile(path.join(dir, 'sess_c.jsonl'), partial, 'utf8');

    const entries = await listRecentSessions(root, 5);
    expect(entries.map((e) => e.title)).toEqual(['你好']);

    expect(await listRecentSessions(path.join(root, 'nope'), 5)).toEqual([]);
  });

  it('reads the workspace marker, falling back to the env fragment cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-sessions-'));
    const dir = path.join(root, '2026', '09', '06');
    await mkdir(dir, { recursive: true });

    const created = await Session.create(dir);
    expect(sessionWorkspace(created)).toBeUndefined();
    await recordSessionWorkspace(created, 'D:\\下载\\新建文件夹');
    expect(sessionWorkspace(created)).toBe('D:\\下载\\新建文件夹');

    // Legacy session without the marker: the seeded fragment's cwd= line.
    const legacy = await Session.create(dir);
    await legacy.append({
      id: 'm0',
      ts: 1,
      role: 'user',
      content: '<environment>\nplatform=win32\ncwd=D:\\web\\agent\nshell=bash\ntoday=2026-09-06\n</environment>',
    });
    expect(sessionWorkspace(legacy)).toBe('D:\\web\\agent');
  });
});
