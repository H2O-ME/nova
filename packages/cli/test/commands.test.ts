import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createModelListCache, filterCommands, modeOverviewRows, COMMAND_SPECS } from '../src/commands.js';
import {
  cacheHitPct,
  lastCacheHitPct,
  modelListError,
  nextApprovalMode,
  openFreshSession,
  pluginToolLine,
} from '../src/command-core.js';
import { createUsageAnchors } from '../src/runner-loop.js';

describe('filterCommands', () => {
  it('matches by prefix when input is a bare slash command', () => {
    // Order is an implementation choice; the user-visible contract is only
    // "both /model and /mode match the /m and /mode prefixes".
    const mMatches = filterCommands('/m').map((s) => s.name);
    expect(mMatches).toContain('/model');
    expect(mMatches).toContain('/mode');

    const modeMatches = filterCommands('/mode').map((s) => s.name);
    expect(modeMatches).toContain('/model');
    expect(modeMatches).toContain('/mode');

    // Bare slash lists every command.
    expect(filterCommands('/').map((s) => s.name).sort()).toEqual(
      COMMAND_SPECS.map((s) => s.name).sort(),
    );
  });

  it('closes once the user types arguments', () => {
    expect(filterCommands('/model gpt')).toEqual([]);
    expect(filterCommands('hello')).toEqual([]);
    expect(filterCommands('')).toEqual([]);
  });
});

describe('createModelListCache', () => {
  it('caches the fetched list within the ttl', async () => {
    let calls = 0;
    const fetchList = async (): Promise<string[]> => {
      calls += 1;
      return ['a'];
    };
    const cached = createModelListCache(fetchList, 60_000);
    await cached();
    await cached();
    expect(calls).toBe(1);
  });

  it('refetches after the ttl expires', async () => {
    let calls = 0;
    const fetchList = async (): Promise<string[]> => {
      calls += 1;
      return ['a'];
    };
    const cached = createModelListCache(fetchList, 0);
    await cached();
    await cached();
    expect(calls).toBe(2);
  });
});

describe('modeOverviewRows', () => {
  // /mode 曾在命令目录里声明却没被 readline 实现接住（落「未知命令」）——
  // 行构造收进 commands.ts 后，此用例钉住三态行语义。
  it('marks exactly the current mode and renders all three hints', () => {
    const rows = modeOverviewRows('ptc');
    expect(rows.map((r) => r.current)).toEqual([false, true, false]);
    expect(rows[0]!.text).toContain('普通');
    expect(rows[1]!.text).toContain('❯');
    expect(rows[1]!.text).toContain('PTC');
    expect(rows[2]!.text).toContain('run_code 与原生调用并存');
  });

  it('defaults marker to native when asked', () => {
    const rows = modeOverviewRows('native');
    expect(rows[0]!.current).toBe(true);
    expect(rows[0]!.text).toContain('❯');
  });
});

describe('command-core', () => {
  it('/approvals cycles through the three tiers', () => {
    expect(nextApprovalMode('read-only')).toBe('auto-edit');
    expect(nextApprovalMode('auto-edit')).toBe('full');
    expect(nextApprovalMode('full')).toBe('read-only');
  });

  it('cache hit rates floor at 0.0 and report null without last usage', () => {
    expect(cacheHitPct(0, 0)).toBe('0.0');
    expect(cacheHitPct(100, 33)).toBe('33.0');
    expect(lastCacheHitPct(undefined)).toBeNull();
    expect(lastCacheHitPct({ promptTokens: 0, completionTokens: 1, cachedTokens: 0 })).toBeNull();
    expect(lastCacheHitPct({ promptTokens: 100, completionTokens: 1, cachedTokens: 50 })).toBe('50');
  });

  it('formats plugin rows and model-list errors identically for both shells', () => {
    expect(pluginToolLine('builtin', 'read_file', '读取')).toBe('插件=builtin · 工具=read_file · 权限=读取');
    expect(modelListError(new Error('timeout'))).toBe('模型列表获取失败：timeout');
    expect(modelListError('boom')).toBe('模型列表获取失败：boom');
  });

  it('openFreshSession seeds a fragment and resets stats + anchors', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-cmd-'));
    const seeded: string[] = [];
    const stats = { promptTokens: 99, completionTokens: 9, cachedTokens: 0, turns: 4, missTokens: 0, missTurns: 0 };
    const anchors = createUsageAnchors();
    anchors.lastPromptTokens = 99;
    let boundId = '';
    const { session, messages } = await openFreshSession({
      sessionsDir: dir,
      rootDir: dir,
      setClientSessionId: (id) => {
        boundId = id;
      },
      stats: stats as never,
      anchors,
      recordWorkspace: async () => undefined,
      seedContext: async (_session, msgs) => {
        // 镜像真实 seedContextFragment：向消息面推入片段消息。
        msgs.push({ id: 'msg_ctx_test', ts: 0, role: 'user', content: 'frag' } as never);
        seeded.push(`${msgs.length}`);
      },
    });
    expect(boundId).toBe(session.id);
    expect(messages).toHaveLength(1); // 只注入的上下文片段
    expect(seeded).toEqual(['1']);
    expect(stats).toEqual({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, turns: 0, missTokens: 0, missTurns: 0 });
    expect(anchors.lastPromptTokens).toBe(0);
    expect(session.file.startsWith(dir)).toBe(true);
  });
});
