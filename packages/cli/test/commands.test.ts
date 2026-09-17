import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createModelListCache, filterCommands, modeOverviewRows, COMMAND_SPECS } from '../src/commands.js';
import {
  agentsMdWrittenLine,
  approvalSwitchLine,
  cacheHitPct,
  helpRows,
  lastCacheHitPct,
  modelListError,
  modelListRows,
  newSessionLine,
  nextApprovalMode,
  openFreshSession,
  pluginCommandLine,
  pluginReportLines,
  pluginToolLine,
  sessionReportLines,
  THEME_NAMES,
  themeSwitchedMessage,
  themeTarget,
  themeUnknownMessage,
  unknownCommandParts,
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

  // 阶段 D 命令核下沉：以下正文单源被 repl 与 TUI 两个 switch 消费，
  // 漂移（如 repl /plugins 曾缺命令行）从此有红测试可钉。
  it('/approvals switch line names the tier via the shared label', () => {
    expect(approvalSwitchLine('auto-edit')).toContain('自动编辑');
    expect(approvalSwitchLine('read-only')).toContain('只读');
  });

  it('helpRows render every spec with a fixed-width usage column', () => {
    const rows = helpRows(COMMAND_SPECS);
    expect(rows).toHaveLength(COMMAND_SPECS.length);
    expect(rows[0]).toMatch(/^ {2}\/\S+/);
    const spec = COMMAND_SPECS.find((s) => s.usage.includes('/compact'))!;
    expect(rows.find((r) => r.includes('/compact'))).toContain(spec.description);
  });

  it('theme accepts exactly the three declared names', () => {
    for (const name of THEME_NAMES) {
      expect(themeTarget(name)).toBe(name);
    }
    expect(themeTarget('cobalt')).toBeUndefined();
    expect(themeTarget('DARK')).toBeUndefined();
    expect(themeUnknownMessage('cobalt')).toContain('cobalt');
    expect(themeSwitchedMessage('light')).toContain('light');
  });

  it('new/init/unknown lines share their copy between shells', () => {
    expect(newSessionLine('/tmp/a.jsonl')).toBe('新会话：/tmp/a.jsonl');
    expect(agentsMdWrittenLine('/proj/AGENTS.md')).toBe('已写入 AGENTS.md');
    const unknown = unknownCommandParts('/nope');
    expect(unknown.head).toBe('未知命令：/nope');
    expect(unknown.hint).toContain('/help');
    expect(pluginCommandLine('p', 'hi', 'desc')).toBe('插件=p · /hi — desc');
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

describe('M9.5 repl 报告行下沉', () => {
  const stats = {
    promptTokens: 1000,
    completionTokens: 50,
    cachedTokens: 900,
    turns: 3,
    missTokens: 2000,
    missTurns: 2,
  };

  it('sessionReportLines: 平铺四行，命中率与上轮命中率并存、未启用压缩如实标注', () => {
    const rows = sessionReportLines({
      file: '/tmp/s.jsonl',
      messageCount: 7,
      stats: stats as never,
      lastUsage: { promptTokens: 1000, completionTokens: 10, cachedTokens: 500 },
      lastPromptTokens: 1234,
      autoCompactTokenLimit: 60000,
    });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('/tmp/s.jsonl');
    expect(rows[1]).toContain('消息 7 条 · 3 轮');
    expect(rows[1]).toContain('（上轮');
    expect(rows[3]).toContain('阈值 60000 tok · 上轮 1234 tok');
    const off = sessionReportLines({
      file: 'f',
      messageCount: 0,
      stats: stats as never,
      lastUsage: undefined,
      lastPromptTokens: 0,
      autoCompactTokenLimit: undefined,
    });
    expect(off[1]).not.toContain('（上轮'); // 无 usage 锚点不谎报上轮命中率
    expect(off[3]).toBe('自动压缩：未启用');
  });

  it('modelListRows: 当前模型带箭头与（当前）标，序号从 1 起', () => {
    const rows = modelListRows('b', ['a', 'b']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(' 1. a');
    expect(rows[1]).toContain('❯');
    expect(rows[1]).toContain('（当前）');
    expect(rows[0]).not.toContain('❯');
  });

  it('pluginReportLines: 工具清单空态提示只出现一次、命令行进清单', () => {
    const rows = pluginReportLines({
      approvalMode: 'read-only',
      override: true,
      tools: [],
      commands: [{ plugin: 'p', name: 'hi', description: 'd' }],
    });
    expect(rows[0]).toContain('（来自 --approval）');
    expect(rows.filter((r) => r.includes('没有已注册的工具'))).toHaveLength(1);
    expect(rows.at(-1)).toContain('hi');
    const withTools = pluginReportLines({
      approvalMode: 'full',
      override: false,
      tools: [{ plugin: 'p', name: 'bash', permission: '执行' }],
      commands: [],
    });
    expect(withTools.some((r) => r.includes('bash'))).toBe(true);
    expect(withTools.some((r) => r.includes('没有已注册的工具'))).toBe(false);
  });
});
