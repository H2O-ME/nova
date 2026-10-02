/**
 * Pure-render tests for the Events card. SSR (`renderToStaticMarkup`) — the
 * same lane every other context card uses — so the test runs no DOM, no fetch,
 * no act/waitFor. What SSR sees is the card's first paint: every event the
 * fold emitted.
 *
 * The card's own contract (one row per event newest-first, each kind with its
 * glyph and Chinese label, the reclaim delta only where it is real) is the
 * piece that would silently regress on a rename or a reorder — it gets its own
 * assertions, not just a `data-context-*` marker check.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ContextBreakdown,
  ContextEventRecord,
  ContextTimeline,
} from '../src/types.js';
import { EventsCard } from '../src/context/EventsCard.js';

function cats(overrides: Partial<ContextBreakdown> = {}): ContextBreakdown {
  return { system: 0, tools: 0, injected: 0, user: 0, assistant: 0, tool: 0, ...overrides };
}

/** Anchor dates on a fixed epoch so the relative stamps are stable across runs. */
const NOW_ANCHOR = 1_700_000_000_000; // 2023-11-14 UTC

function timeline(overrides: Partial<ContextTimeline> = {}): ContextTimeline {
  return {
    truncated: false,
    live: { cats: cats(), total: 0, elements: [] },
    counts: { requests: 0, turns: 0, toolCalls: 0, compactions: 0 },
    points: [],
    events: [],
    files: [],
    ...overrides,
  };
}

describe('EventsCard', () => {
  it('hides the list (and surfaces the empty prompt) when no event was emitted', () => {
    const html = renderToStaticMarkup(<EventsCard timeline={timeline()} />);
    expect(html).toContain('data-context-events');
    expect(html).toContain('还没有改变窗口的事件');
  });

  it('lists events newest-first (the order a reader asks "what just happened")', () => {
    const events: ContextEventRecord[] = [
      { seq: 5, at: NOW_ANCHOR - 60_000, kind: 'workspace', detail: '/later' },
      { seq: 12, at: NOW_ANCHOR, kind: 'compaction', freed: 1500 },
    ];
    const html = renderToStaticMarkup(<EventsCard timeline={timeline({ events })} />);
    expect(html).toContain('data-context-events');
    expect(html).toContain('2 条');
    // The compaction row (seq 12, latest) must come before the workspace row.
    const latestIdx = html.indexOf('−1,500 tok');
    const earlierIdx = html.indexOf('/later');
    expect(latestIdx).toBeGreaterThanOrEqual(0);
    expect(earlierIdx).toBeGreaterThan(latestIdx);
  });

  it('renders each kind with its own glyph and Chinese label', () => {
    const events: ContextEventRecord[] = [
      { seq: 1, at: NOW_ANCHOR, kind: 'compaction', freed: 1000 },
      { seq: 2, at: NOW_ANCHOR, kind: 'workspace', detail: '/proj' },
      { seq: 3, at: NOW_ANCHOR, kind: 'goal', detail: '完成 P2' },
    ];
    const html = renderToStaticMarkup(<EventsCard timeline={timeline({ events })} />);
    expect(html).toContain('压缩');
    expect(html).toContain('工作区');
    expect(html).toContain('目标');
    expect(html).toContain('✂');
    expect(html).toContain('⇆');
    expect(html).toContain('◎');
    // data-event-kind on every row lets a regression test pick kind out.
    expect(html.match(/data-event-kind="(compaction|workspace|goal)"/g)).toHaveLength(3);
  });

  it('renders the freed-token delta only when positive, and never on non-compaction rows', () => {
    const events: ContextEventRecord[] = [
      { seq: 1, at: NOW_ANCHOR, kind: 'compaction', freed: 0 },
      { seq: 2, at: NOW_ANCHOR, kind: 'compaction', freed: 2_500 },
      { seq: 3, at: NOW_ANCHOR, kind: 'goal' },
    ];
    const html = renderToStaticMarkup(<EventsCard timeline={timeline({ events })} />);
    // Positive reclaim surfaces the signed delta.
    expect(html).toContain('−2,500 tok');
    // Zero-freed compactions and goal rows do not surface a delta.
    expect(html).not.toContain('−0 tok');
  });
});
