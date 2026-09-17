import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Session } from '@nova-agent/core';
import { plainPalette } from '@nova-agent/tui-view';
import { describe, expect, it } from 'vitest';
import { TuiStore } from '../src/tui/store.js';
import { switchSessionTo, type SessionSwitchDeps } from '../src/tui/session-switch.js';

async function makeSession(userTexts: string[], assistantTexts: string[]): Promise<Session> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-switch-'));
  const session = await Session.create(dir);
  let n = 0;
  for (const text of userTexts) {
    n += 1;
    await session.append({ id: `msg_u${n}`, ts: 0, role: 'user', content: text });
  }
  for (const [i, text] of assistantTexts.entries()) {
    await session.append({ id: `msg_a${i}`, ts: 0, role: 'assistant', content: text });
  }
  return session;
}

function setup(overrides: Partial<SessionSwitchDeps> = {}) {
  const store = new TuiStore(() => undefined);
  const calls: string[] = [];
  const deps: SessionSwitchDeps = {
    store,
    paint: () => plainPalette,
    loadSession: async () => {
      throw new Error('not set');
    },
    workspaceOf: () => undefined,
    currentRoot: () => 'C:/work/current',
    isInDataDir: () => false,
    dirExists: () => true,
    applyWorkspace: async () => {
      calls.push('applyWorkspace');
    },
    rebind: () => {
      calls.push('rebind');
    },
    afterRebind: () => {
      calls.push('afterRebind');
    },
    render: () => undefined,
    ...overrides,
  };
  return { store, calls, deps };
}

describe('switchSessionTo', () => {
  it('refuses to switch while a turn or compaction is in flight', async () => {
    const { store, deps } = setup();
    store.streaming = true;
    await switchSessionTo(deps, { file: 'x.jsonl' });
    expect(store.blocks[0]!.lines[0]).toContain('当前轮未结束');
  });

  it('surfaces open failures with the actionable error text', async () => {
    const { store, deps } = setup({
      loadSession: async () => {
        throw new Error('boom');
      },
    });
    await switchSessionTo(deps, { file: 'x.jsonl' });
    expect(store.blocks[0]!.lines[0]).toContain('会话读取失败');
    expect(store.blocks[0]!.lines[0]).toContain('boom');
  });

  it('replays user/assistant text after rebind and ends with the switch line', async () => {
    const session = await makeSession(['第一个问题', '<environment>注入片段'], ['**回答**一']);
    const { store, calls, deps } = setup({ loadSession: async () => session });
    await switchSessionTo(deps, { file: session.file });
    expect(calls).toEqual(['rebind', 'afterRebind']);
    const kinds = store.blocks.map((b) => b.kind);
    expect(kinds).toContain('user');
    expect(kinds).toContain('assistant');
    // 注入片段（`<…` 开头）不进回放面。
    const userBlock = store.blocks.find((b) => b.kind === 'user')!;
    expect(userBlock.lines.join('\n')).toContain('第一个问题');
    expect(userBlock.lines.join('\n')).not.toContain('environment');
    expect(store.blocks.at(-1)!.lines[0]).toContain('已切换到会话');
  });

  it('explains an empty replay surface instead of showing a bare switch line', async () => {
    const session = await makeSession(['<environment>只有片段'], []);
    const { store, deps } = setup({ loadSession: async () => session });
    await switchSessionTo(deps, { file: session.file });
    expect(store.blocks.some((b) => b.lines.join('').includes('没有可回放的文本消息'))).toBe(true);
  });

  it('never applies a workspace pointing at the nova data dir', async () => {
    const session = await makeSession(['hi'], []);
    const { store, calls, deps } = setup({
      loadSession: async () => session,
      workspaceOf: () => path.join('C:', '.nova'),
      isInDataDir: () => true,
    });
    await switchSessionTo(deps, { file: session.file });
    expect(calls).not.toContain('applyWorkspace');
    expect(store.blocks.at(-1)!.lines[0]).toContain('nova 数据目录');
  });

  it('follows the session home when its workspace exists elsewhere', async () => {
    const session = await makeSession(['hi'], []);
    const { calls, deps } = setup({
      loadSession: async () => session,
      workspaceOf: () => 'D:/other/repo',
    });
    await switchSessionTo(deps, { file: session.file });
    expect(calls).toContain('applyWorkspace');
  });
});
