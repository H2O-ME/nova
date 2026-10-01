/**
 * A server-render pass over the 上下文 pane: no DOM, no browser —
 * `renderToStaticMarkup` walks the real JSX with the fold's real shape. Pinned
 * here: the six cards a reading draws (stats / composition / trend / elements /
 * events / files), the figures the fold put in, and the empty reading. Hover and
 * pin are interaction state and the state lane has no DOM, so what the POINTER
 * does is asserted on the pure model (context-model.test.ts) and what a first
 * paint shows is asserted here.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContextBreakdown, ContextTimeline } from '../src/types.js';
import { ContextView } from '../src/context/ContextView.js';

function cats(overrides: Partial<ContextBreakdown> = {}): ContextBreakdown {
  return { system: 0, tools: 0, injected: 0, user: 0, assistant: 0, tool: 0, ...overrides };
}

const TIMELINE: ContextTimeline = {
  truncated: false,
  live: {
    cats: cats({ system: 1200, tools: 2800, injected: 400 }),
    total: 4400,
    elements: [
      { seq: 1, cat: 'tools', label: 'read_file', tokens: 2000 },
      { seq: 2, cat: 'system', label: '系统提示', tokens: 1200, preview: '你是 Nova' },
      { seq: 3, cat: 'injected', label: '技能索引', tokens: 400 },
    ],
  },
  counts: { requests: 2, turns: 1, toolCalls: 3, compactions: 1 },
  points: [
    { seq: 1, at: 1_700_000_000_000, cats: cats({ system: 1000 }), total: 1000, prompt: 900, cached: 800, output: 20 },
    { seq: 4, at: 1_700_000_100_000, cats: cats({ system: 1200, tools: 2800 }), total: 4000, prompt: 4100, cached: 3000, output: 40 },
  ],
  events: [
    { seq: 2, at: 1_700_000_050_000, kind: 'compaction', freed: 1500 },
    { seq: 5, at: 1_700_000_150_000, kind: 'workspace', detail: 'D:/web/agent' },
  ],
  files: [{ path: 'src/app.ts', reads: 2, writes: 1, searches: 0, added: 12, removed: 3, seq: 6 }],
};

const render = (timeline: ContextTimeline | null, window?: number): string =>
  renderToStaticMarkup(
    <ContextView
      timeline={timeline}
      {...(window !== undefined ? { window } : {})}
      onRefresh={() => undefined}
    />,
  );

describe('ContextView', () => {
  it('draws all six cards with the reading the fold produced', () => {
    const html = render(TIMELINE, 10_000);
    for (const card of [
      'data-context-stats',
      'data-context-headline',
      'data-context-trend',
      'data-context-elements',
      'data-context-events',
      'data-context-files',
    ]) {
      expect(html).toContain(card);
    }
    // The headline states the live estimate against the window the host passed.
    expect(html).toContain('4,400');
    expect(html).toContain('/ 10,000 tokens');
    // The stats strip carries the session's shape and the newest usage's hit.
    expect(html).toContain('缓存命中');
    expect(html).toContain('73%');
    // One trend bar per request, and the axis is labelled from the scale down.
    expect(html.match(/data-seq=/g)).toHaveLength(2);
    expect(html).toContain('10K');
    // The element board names the window's units, heaviest first.
    expect(html).toContain('read_file');
    expect(html).toContain('技能索引');
    // The event log and the file activity keep their rows.
    expect(html).toContain('回收约 1500 tokens');
    expect(html).toContain('D:/web/agent');
    expect(html).toContain('src/app.ts');
  });

  it('states the unknown window instead of drawing a percentage', () => {
    const html = render(TIMELINE);
    expect(html).toContain('tokens（估算）');
    expect(html).not.toContain('上下文已用');
  });

  it('says the plugin is off rather than drawing an empty dashboard', () => {
    expect(render(null)).toContain('上下文插件未开启。');
  });
});
