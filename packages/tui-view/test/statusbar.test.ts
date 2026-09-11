/**
 * 状态栏纯计算层单测：降级优先级（先丢瞬时提示、再整字段降档）、
 * 右缘定宽、上下文分解的"段总和 === used"不变量。plainPalette 下
 * 输出不含 ANSI，可直接字符串断言；宽度不变量走 styledWidth。
 */

import { styledWidth } from '@nova-agent/tui';
import type { AgentMessage } from '@nova-agent/core';
import { describe, expect, it } from 'vitest';
import { plainPalette, clipToWidth } from '../src/index.js';
import { codeModeLabel, contextBreakdown, gaugeCacheKey, statusBar, type StatusView } from '../src/index.js';

const user = (content: string): AgentMessage => ({ id: 'u', ts: 0, role: 'user', content });
const asst = (content: string): AgentMessage => ({ id: 'a', ts: 0, role: 'assistant', content });

describe('contextBreakdown', () => {
  const base = {
    systemPrompt: 'SYSTEM PROMPT',
    tools: [{ name: 'bash', description: 'run a command', parameters: { type: 'object' } }],
    anchorMsgCount: 0,
    contextWindow: 100_000,
    modelMetaContextWindow: undefined,
  };

  it('segments always sum to used (no anchor: pure estimate)', () => {
    const messages = [user('<ctx>hello</ctx>'), asst('hi there')];
    const r = contextBreakdown({ ...base, messages, usageAnchor: undefined });
    expect(r.segments.reduce((s, x) => s + x.tokens, 0)).toBe(r.used);
    expect(r.capacity).toBe(100_000);
  });

  it('splits the skill index out of the injected fragment', () => {
    const messages = [user('<env><available_skills>SKILL A SKILL B</available_skills>tail</env>')];
    const r = contextBreakdown({ ...base, messages, usageAnchor: undefined });
    const skill = r.segments.find((s) => s.label === '技能')!;
    const injected = r.segments.find((s) => s.label === '注入')!;
    expect(skill.tokens).toBeGreaterThan(0);
    expect(injected.tokens).toBeGreaterThan(0);
    expect(skill.tokens + injected.tokens).toBeGreaterThan(skill.tokens); // 两段共存
  });

  it('anchor usage becomes the total; segments calibrate onto it', () => {
    const messages = [user('hi'), asst('yo'), user('more')];
    const anchor = { promptTokens: 5000, completionTokens: 10, cachedTokens: 0 };
    const r = contextBreakdown({ ...base, messages, usageAnchor: anchor, anchorMsgCount: 2 });
    // used = anchor.promptTokens + 未覆盖消息（第 3 条）的估算。
    expect(r.used).toBeGreaterThan(5000);
    expect(r.segments.reduce((s, x) => s + x.tokens, 0)).toBe(r.used);
    // 提示词段吸收了逐段取整的残差，总和与 used 精确相等。
    expect(r.segments[0]!.tokens).toBeGreaterThan(0);
  });

  it('capacity falls back to models.dev metadata', () => {
    const r = contextBreakdown({
      ...base,
      contextWindow: undefined,
      modelMetaContextWindow: 200_000,
      messages: [user('x')],
      usageAnchor: undefined,
    });
    expect(r.capacity).toBe(200_000);
  });
});

describe('gaugeCacheKey', () => {
  const base = {
    messagesLen: 3,
    usageAnchor: undefined,
    model: 'm',
    codeMode: 'native' as const,
    modelMetaVersion: 0,
    capacity: 100_000,
    toolCount: 5,
    compactLimit: undefined,
    cols: 120,
  };
  it('changes when any render-relevant input changes', () => {
    const k = gaugeCacheKey(base);
    expect(gaugeCacheKey({ ...base, messagesLen: 4 })).not.toBe(k);
    expect(gaugeCacheKey({ ...base, cols: 119 })).not.toBe(k);
    expect(gaugeCacheKey({ ...base, codeMode: 'ptc' })).not.toBe(k);
    expect(gaugeCacheKey({ ...base, usageAnchor: { promptTokens: 1, completionTokens: 0, cachedTokens: 0 } })).not.toBe(k);
    expect(gaugeCacheKey(base)).toBe(k); // 稳定
  });
});

const baseView: StatusView = {
  cols: 200,
  model: 'vendor/claude-test',
  approvalMode: 'auto-edit',
  codeMode: 'native',
  pristine: true,
  streaming: false,
  interruptAt: 0,
  inputEmpty: true,
  lastCtrlC: 0,
  now: 1_000_000,
  tpsRing: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  promptTokens: 200,
  cachedTokens: 150,
  cacheSeen: true,
  gaugeForms: ['G0', 'G1', 'G2'],
};

const bar = (over: Partial<StatusView> = {}): string => statusBar(plainPalette, { ...baseView, ...over });

describe('statusBar composition (wide)', () => {
  it('T0 keeps gauge/model/mode-chips/approval-label/hints and pins the right cluster', () => {
    const b = bar({ lastCtrlC: 999_500 }); // now-lastCtrlC=500ms → 退出提示在
    // 芯片自带前后空格：' 混合 ' 与 join 的 ' · ' 相连处是双空格。
    expect(b.startsWith('G0 │ vendor/claude-test · 模式  普通  PTC  混合  · 审批 自动编辑 │ 再按一次 Ctrl+C 退出')).toBe(true);
    expect(b.endsWith('tps ▂▂▃▄▅▅▆▇▇█  10 · cache 75%')).toBe(true);
  });

  it('interrupt hint renders while streaming with abort pending', () => {
    expect(bar({ streaming: true, interruptAt: 5 })).toContain('■ 等待工具退出…');
    expect(bar({ streaming: false, interruptAt: 5 })).not.toContain('■ 等待工具退出…');
  });

  it('cache segment is sticky-visible only after first report', () => {
    expect(bar({ cacheSeen: false })).not.toContain('cache ');
    expect(bar({ cacheSeen: true })).toContain('cache 75%');
  });
});

describe('statusBar degradation order', () => {
  /** 随 cols 收窄，左段形态单调地 clip→T2→T1→T0。 */
  const formOf = (b: string): string => {
    if (b.includes('G0')) return b.includes('claude-test') ? 'T0' : 'T0-noModel';
    if (b.includes('G1')) return 'T1';
    if (b.includes('G2')) return b.includes('claude-test') ? 'T2' : 'T2-noModel';
    return 'clip';
  };
  it('narrows monotonically T0→T1→T2→(drop model)→clip', () => {
    const rank: Record<string, number> = { clip: 0, 'T2-noModel': 1, 'T2': 2, 'T1': 3, 'T0': 4, 'T0-noModel': 5 };
    let prev = -1;
    for (let cols = 36; cols <= 200; cols++) {
      const r = rank[formOf(bar({ cols }))];
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(formOf(bar({ cols: 200 }))).toBe('T0');
    // cols=40：整行只剩"仪表最简档被截 + 右缘"；cols=22：连仪表标号都被截光。
    expect(bar({ cols: 40 })).toContain('…');
    expect(formOf(bar({ cols: 22 }))).toBe('clip');
  });

  it('transient hints drop BEFORE any tier downgrade', () => {
    // 找到"提示仍在"最窄的 cols 与"降档"最宽的 cols：提示必须先到 0。
    let widestHint = -1;
    let narrowestT0 = Infinity;
    for (let cols = 36; cols <= 200; cols++) {
      const b = bar({ cols, lastCtrlC: 999_500 });
      if (b.includes('再按一次')) widestHint = Math.max(widestHint, cols);
      if (b.includes('审批 自动编辑')) narrowestT0 = Math.min(narrowestT0, cols);
    }
    expect(widestHint).toBeGreaterThan(-1);
    expect(narrowestT0).toBeLessThan(Infinity);
    // 存在一个窗口：T0 完整档位还在、提示已被丢——这正是"先丢提示"的证据。
    let sawHintGoneButT0 = false;
    for (let cols = narrowestT0; cols <= widestHint + 30; cols++) {
      const b = bar({ cols, lastCtrlC: 999_500 });
      if (!b.includes('再按一次') && b.includes('审批 自动编辑')) sawHintGoneButT0 = true;
    }
    expect(sawHintGoneButT0).toBe(true);
    // 且提示消失得比降档早：最宽提示位点 > 最窄 T0 位点（提示先没）。
    expect(widestHint).toBeGreaterThan(narrowestT0 - 1);
  });

  it('never exceeds the row budget at any width (no wrap)', () => {
    // renderFrame 的不变量：statusBar 之外还有一层 clipToWidth(cols-1) 兜底
    // （极窄时右缘 tps 组自身就超预算，statusBar 内部无法再压）。
    for (let cols = 20; cols <= 200; cols++) {
      expect(styledWidth(clipToWidth(bar({ cols }), cols - 1))).toBeLessThanOrEqual(cols - 1);
    }
  });
});

describe('statusBar right-edge stability', () => {
  it('tps digits and cache percent changing width-wise never move the layout', () => {
    const a = bar({ tpsRing: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    const b = bar({ tpsRing: [9, 12, 133, 0, 0, 0, 0, 0, 0, 100] });
    expect(styledWidth(a)).toBe(styledWidth(b));
    const c = bar({ promptTokens: 200, cachedTokens: 5 }); // 2%
    const d = bar({ promptTokens: 200, cachedTokens: 150 }); // 75%
    expect(styledWidth(c)).toBe(styledWidth(d));
  });

  it('left segment keeps its bytes while only the right cluster refreshes', () => {
    const cols = 200;
    const a = bar({ cols, tpsRing: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
    const b = bar({ cols, tpsRing: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] });
    const left = a.slice(0, a.indexOf('tps'));
    expect(b.slice(0, b.indexOf('tps'))).toBe(left);
  });
});

describe('codeModeLabel', () => {
  it('maps the three modes', () => {
    expect(codeModeLabel('native')).toBe('普通');
    expect(codeModeLabel('ptc')).toBe('PTC');
    expect(codeModeLabel('both')).toBe('混合');
  });
});
