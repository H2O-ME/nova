/**
 * The Token 统计 card: its ring geometry, its reading, and a server-render pass
 * over the card itself. No DOM — the ring's proportions are numbers and the
 * card's figures are strings, so both are asserted directly.
 *
 * The card is aligned to dsh-context's `statsTokens`/`donut` (Apache-2.0); the
 * pinned contract here is the one that card exists for: the ring's total IS the
 * session's billed total (prompt + completion, the composer's pill figure), and
 * only the prompt-side SPLIT is apportioned by the window's own ratios.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContextBreakdown, ContextTimeline } from '../src/types.js';
import { emptyTotals, type SessionTotals } from '@nova-agent/core/totals';
import { donutArcs, SEG_GAP } from '../src/context/donut-model.js';
import { tokenStats } from '../src/context/token-stats.js';
import { TokenStatsCard } from '../src/context/TokenStatsCard.js';

function cats(overrides: Partial<ContextBreakdown> = {}): ContextBreakdown {
  return { system: 0, tools: 0, injected: 0, user: 0, assistant: 0, tool: 0, ...overrides };
}

const TIMELINE: ContextTimeline = {
  truncated: false,
  live: { cats: cats({ system: 1000, tools: 3000 }), total: 4000, elements: [] },
  counts: { requests: 2, turns: 1, toolCalls: 0, compactions: 0 },
  points: [],
  events: [],
  files: [],
};

const TOTALS: SessionTotals = { ...emptyTotals, promptTokens: 10_000, completionTokens: 1_000 };

describe('donutArcs', () => {
  it('splits the ring by weight, clockwise from 12 o\'clock, parting neighbours on a hairline', () => {
    const arcs = donutArcs([
      { key: 'a', color: 'var(--a)', value: 50 },
      { key: 'b', color: 'var(--b)', value: 50 },
    ]);
    expect(arcs).toHaveLength(2);
    // Each slice gives up half a gap at both ends, and starts half a gap later.
    expect(arcs[0]!.len).toBeCloseTo(50 - SEG_GAP, 6);
    expect(arcs[1]!.len).toBeCloseTo(50 - SEG_GAP, 6);
    // The first arc starts at the +25 offset (12 o'clock); the second a half
    // lap later, each having given up half a gap at both of its ends.
    expect(arcs[0]!.offset).toBeCloseTo(125 - SEG_GAP / 2, 6);
    expect(arcs[1]!.offset).toBeCloseTo(75 - SEG_GAP / 2, 6);
  });

  it('paints nothing for an empty or all-zero ring, and skips zero weights', () => {
    expect(donutArcs([])).toEqual([]);
    expect(donutArcs([{ key: 'a', color: 'var(--a)', value: 0 }])).toEqual([]);
    const arcs = donutArcs([
      { key: 'a', color: 'var(--a)', value: 0 },
      { key: 'b', color: 'var(--b)', value: 4 },
    ]);
    expect(arcs.map((arc) => arc.key)).toEqual(['b']);
    // A lone painted slice keeps its full ring: a gap there would read as a nick.
    expect(arcs[0]!.len).toBeCloseTo(100, 6);
  });
});

describe('tokenStats', () => {
  it('anchors the total to the billed session totals, not to a second estimate', () => {
    const reading = tokenStats(TIMELINE, TOTALS);
    expect(reading.total).toBe(11_000);
    expect(reading.reported).toBe(true);
    // The prompt side is apportioned by the LIVE window's ratios: system 1/4,
    // tools 3/4 of the 10,000 billed input.
    const byKey = new Map(reading.rows.map((row) => [row.key, row]));
    expect(byKey.get('system')!.tokens).toBe(2_500);
    expect(byKey.get('tools')!.tokens).toBe(7_500);
    expect(byKey.get('user')!.tokens).toBe(0);
    // Output is the provider's own count, and it closes the ring.
    expect(byKey.get('output')!.tokens).toBe(1_000);
    const summed = reading.rows.reduce((sum, row) => sum + row.tokens, 0);
    expect(summed).toBe(reading.total);
  });

  it('marks the apportioned categories with ≈ and the provider count without it', () => {
    const rows = new Map(tokenStats(TIMELINE, TOTALS).rows.map((row) => [row.key, row]));
    expect(rows.get('system')!.count).toBe('≈2.5K');
    expect(rows.get('output')!.count).toBe('1K');
    // A zero-weight row dims whole; the ring already carries its share.
    expect(rows.get('user')!.dim).toBe(true);
    expect(rows.get('output')!.dim).toBe(false);
  });

  it('falls back to the newest request\'s ratios when the live window is empty', () => {
    const stale: ContextTimeline = {
      ...TIMELINE,
      live: { cats: cats(), total: 0, elements: [] },
      points: [{ seq: 1, at: 0, cats: cats({ tools: 90, system: 10 }), total: 100 }],
    };
    const rows = new Map(tokenStats(stale, TOTALS).rows.map((row) => [row.key, row]));
    expect(rows.get('tools')!.tokens).toBe(9_000);
    expect(rows.get('system')!.tokens).toBe(1_000);
  });

  it('reports nothing billed rather than a ring of zeroes that reads as full', () => {
    const reading = tokenStats(TIMELINE, emptyTotals);
    expect(reading.total).toBe(0);
    expect(reading.reported).toBe(false);
    expect(donutArcs(reading.slices)).toEqual([]);
    expect(reading.rows.every((row) => row.pct === '—')).toBe(true);
  });
});

describe('TokenStatsCard', () => {
  it('draws the ring, the total and every legend row', () => {
    const html = renderToStaticMarkup(<TokenStatsCard timeline={TIMELINE} totals={TOTALS} />);
    expect(html).toContain('data-context-tokens');
    expect(html).toContain('Token 统计');
    expect(html).toContain('11K');
    expect(html).toContain('总用量');
    expect(html).toContain('工具定义');
    expect(html).toContain('输出');
    expect(html).toContain('≈7.5K');
  });

  it('shows a dash centre when the session has billed nothing', () => {
    const html = renderToStaticMarkup(<TokenStatsCard timeline={TIMELINE} totals={emptyTotals} />);
    expect(html).toContain('>—</b>');
  });
});
