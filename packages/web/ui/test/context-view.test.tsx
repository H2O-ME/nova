/**
 * A server-render pass over the 上下文 pane: no DOM, no browser —
 * `renderToStaticMarkup` walks the real JSX with the fold's real shape. Pinned
 * here: the cards a reading draws (stats / composition / trend / timing /
 * elements / events / files / DNA), the figures the fold put in, and
 * the empty reading. Hover and pin are interaction state and the state lane has
 * no DOM, so what the POINTER does is asserted on the pure model
 * (context-model.test.ts) and what a first paint shows is asserted here.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContextBreakdown, ContextTimeline } from '../src/types.js';
import { emptyTotals } from '@nova-agent/core/totals';
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
      totals={{ ...emptyTotals, promptTokens: 5_000, completionTokens: 60 }}
      onRefresh={() => undefined}
    />,
  );

describe('ContextView', () => {
  it('draws every card the reading supports', () => {
    const html = render(TIMELINE, 10_000);
    for (const card of [
      'data-context-stats',
      'data-context-tokens',
      'data-context-headline',
      'data-context-trend',
      'data-context-elements',
      'data-context-events',
      'data-context-files',
    ]) {
      expect(html).toContain(card);
    }
    // The timing card HIDES when no point carries timing (the case here), so
    // it appears zero times — the assertion is the absence, paired with the
    // dedicated timing test below that supplies timing and asserts presence.
    expect(html).not.toContain('data-context-timing');
    // The dashboard card SELF-FETCHES on mount; SSR runs no effects, so the
    // reading stays undefined and the wrapper renders nothing — the assertion
    // is the absence, paired with the dedicated dashboard test.
    expect(html).not.toContain('data-context-dashboard');
    // The DNA card draws from points alone, so it renders even without a
    // sessionFile — the per-request composition strips.
    expect(html).toContain('data-context-dna');
    // The headline states the live estimate against the window the host passed.
    expect(html).toContain('4,400');
    expect(html).toContain('/ 10,000 tokens');
    // The stats strip carries the session's shape and the newest usage's hit.
    expect(html).toContain('缓存命中');
    expect(html).toContain('73%');
    // One trend bar per request; the axis scales to the TALLEST request (4K),
    // never to the 10K window the host passed — a window-pinned axis flattens
    // every bar of a young session onto the floor (the reported regression).
    expect(html.match(/data-seq=/g)).toHaveLength(2);
    expect(html).toContain('4K');
    expect(html).not.toContain('10K');
    // The composition rows are the whole reading under the chart; the
    // identity/metric line the reference puts above them is NOT repeated here
    // (the hover bubble names the request) — asserted as an absence.
    expect(html).not.toContain('第 2 次请求');
    expect(html).not.toContain('输入 ');
    expect(html).toContain('≈');
    expect(html).toContain('工具结果');
    // The 自适应 switch rides the trend card's title (the reference's chip).
    expect(html).toContain('自适应');
    // The element board names the window's units, heaviest first.
    expect(html).toContain('read_file');
    expect(html).toContain('技能索引');
    // The file activity keeps its rows; the events card surfaces the fold's
    // event log newest-first (one row per event the fold emitted).
    expect(html).toContain('src/app.ts');
    expect(html).toContain('data-context-events');
    expect(html).toContain('−1,500 tok');
  });

  it('states the unknown window instead of drawing a percentage', () => {
    const html = render(TIMELINE);
    expect(html).toContain('tokens（估算）');
    expect(html).not.toContain('上下文已用');
  });

  it('says the plugin is off rather than drawing an empty dashboard', () => {
    expect(render(null)).toContain('上下文插件未开启。');
  });

  it('hides the timing card when no point carries timing', () => {
    // TIMELINE's points have no `timing` field set, so the card renders nothing
    // rather than an empty "no data" section — paired with the next test that
    // supplies timing and asserts the card surfaces.
    const html = render(TIMELINE, 10_000);
    expect(html).not.toContain('data-context-timing');
    expect(html).not.toContain('请求时序');
  });

  it('renders TTFT and duration per request when points carry timing', () => {
    const BASE = 1_700_000_000_000;
    const withTiming: ContextTimeline = {
      ...TIMELINE,
      points: [
        {
          seq: 1,
          at: BASE,
          cats: cats({ system: 1000 }),
          total: 1000,
          timing: { startedAt: BASE, firstTokenAt: BASE + 350, finishedAt: BASE + 2_400 },
        },
        {
          seq: 4,
          at: BASE + 100,
          cats: cats({ system: 1200 }),
          total: 1200,
          // Only startedAt — a request still in flight has neither TTFT nor
          // duration yet, so it becomes no row rather than two dashes.
          timing: { startedAt: BASE + 100 },
        },
        {
          seq: 7,
          at: BASE + 200,
          cats: cats({ system: 1500 }),
          total: 1500,
          timing: { startedAt: BASE + 5_000, firstTokenAt: BASE + 5_900, finishedAt: BASE + 9_800 },
        },
      ],
    };
    const html = render(withTiming, 10_000);
    expect(html).toContain('data-context-timing');
    expect(html).toContain('请求时序');
    // First request: TTFT 350ms, duration 2.4s.
    expect(html).toContain('第 1 次');
    expect(html).toContain('350ms');
    expect(html).toContain('2.4s');
    // The in-flight second point produced no TIMING row — the timing card
    // surfaces only completed requests. The DNA card still renders its strip
    // (DNA reads from `points`, not from completed timings), so "第 2 次" is
    // present in the DNA section and absent in the timing section. Slice from
    // `data-context-timing` to the NEXT card (`data-context-dna`) to isolate
    // the timing card's own markup.
    const afterTiming = html.indexOf('data-context-timing');
    const nextCard = html.indexOf('data-context-dna', afterTiming);
    const timingHtml = html.slice(afterTiming, nextCard === -1 ? undefined : nextCard);
    expect(timingHtml).not.toContain('第 2 次');
    // Third request: TTFT 900ms, duration 4.8s.
    expect(html).toContain('第 3 次');
    expect(html).toContain('900ms');
    expect(html).toContain('4.8s');
    // The averages strip averages the two completed rows.
    expect(html).toContain('平均');
    // avg TTFT = (350 + 900) / 2 = 625ms.
    expect(html).toContain('625ms');
    // avg duration = (2400 + 4800) / 2 = 3600ms → 3.6s.
    expect(html).toContain('3.6s');
  });
});
