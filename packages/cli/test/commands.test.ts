import { describe, expect, it } from 'vitest';
import { createModelListCache, mergedCommandSpecs, COMMAND_SPECS } from '../src/commands.js';
import { parseApprovalAnswer } from '../src/repl.js';
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

describe('mergedCommandSpecs', () => {
  it('appends registry commands so /goal shows up in every shell catalog', () => {
    const merged = mergedCommandSpecs([{ name: 'goal', description: '目标模式' }]);
    expect(merged.map((s) => s.name)).toContain('/goal');
    expect(merged.find((s) => s.name === '/goal')?.description).toBe('目标模式');
  });

  it('a name both sides claim stays shell-owned exactly once', () => {
    const merged = mergedCommandSpecs([{ name: 'theme', description: '注册表里的同名行' }]);
    expect(merged.filter((s) => s.name === '/theme')).toHaveLength(1);
    expect(merged.find((s) => s.name === '/theme')?.description).not.toContain('同名行');
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

  // 命令核下沉：以下正文单源被 command-runner 消费，
  // 漂移（如 repl /plugins 曾缺命令行）从此有红测试可钉。
  it('/approvals switch line names the tier via the shared label', () => {
    expect(approvalSwitchLine('auto-edit')).toContain('自动编辑');
    expect(approvalSwitchLine('read-only')).toContain('只读');
  });

  it('helpRows render every spec with a fixed-width usage column', () => {
    const rows = helpRows(COMMAND_SPECS);
    expect(rows).toHaveLength(COMMAND_SPECS.length);
    expect(rows[0]).toMatch(/^ {2}\/\S+/);
    const spec = COMMAND_SPECS.find((s) => s.usage.includes('/theme'))!;
    expect(rows.find((r) => r.includes('/theme'))).toContain(spec.description);
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

describe('parseApprovalAnswer（审批行内答案 → AskResult）', () => {
  it('y/a 前缀=allow/always；n/no=纯拒绝', () => {
    expect(parseApprovalAnswer('y')).toBe('allow');
    expect(parseApprovalAnswer('yes')).toBe('allow');
    expect(parseApprovalAnswer('a')).toBe('always');
    expect(parseApprovalAnswer('always')).toBe('always');
    expect(parseApprovalAnswer('n')).toBe('deny');
    expect(parseApprovalAnswer('no')).toBe('deny');
  });
  it('`n <理由>` 把理由折进 DenyGrant（拒绝从死路变成一次指令）', () => {
    expect(parseApprovalAnswer('n 别动 main 分支')).toEqual({ answer: 'deny', reason: '别动 main 分支' });
    expect(parseApprovalAnswer('nope 这命令太危险')).toEqual({ answer: 'deny', reason: '这命令太危险' });
  });
  it('未识别输入 fail-closed 为纯 deny', () => {
    expect(parseApprovalAnswer('run the tests')).toBe('deny');
    expect(parseApprovalAnswer('?')).toBe('deny');
  });
});
