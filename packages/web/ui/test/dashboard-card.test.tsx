/**
 * Pure-render tests for the dashboard card: the corpus overview drawn from one
 * `DashboardReading`. SSR (`renderToStaticMarkup`) — the same lane every other
 * context card uses — so the test runs no DOM, no fetch, no act/waitFor. The
 * self-fetching wrapper (`DashboardCard`) is exercised by mounting it with a
 * stub fetch; this file asserts the SHAPE the fetch result becomes.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardCard, DashboardCardView } from '../src/context/DashboardCard.js';
import type { DashboardReading } from '../src/context/dashboard-fetch.js';

function todayKey(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const READING: DashboardReading = {
  sessions: 7,
  totals: { requests: 42, prompt: 120_000, completion: 8_000 },
  days: [
    { key: todayKey(2), requests: 5, prompt: 10_000, completion: 800 },
    { key: todayKey(0), requests: 12, prompt: 40_000, completion: 3_000 },
  ],
  workspaces: [
    { workspace: '/home/me/project-a', requests: 30, prompt: 90_000, completion: 6_000, sessions: 5 },
    { workspace: '/home/me/project-b', requests: 12, prompt: 30_000, completion: 2_000, sessions: 2 },
    { workspace: '__none__', requests: 0, prompt: 0, completion: 0, sessions: 0 },
  ],
};

describe('DashboardCardView', () => {
  it('renders the corpus summary, the sparkline bars, and the workspace leaderboard', () => {
    const html = renderToStaticMarkup(<DashboardCardView reading={READING} />);
    expect(html).toContain('data-context-dashboard');
    expect(html).toContain('跨会话活动');
    // Trailing totals.
    expect(html).toContain('7 个会话');
    expect(html).toContain('42 次请求');
    // Sparkline: one bar per slot in the 14-day window, gaps filled.
    expect(html.match(/data-empty=/g)).toBeTruthy();
    // Workspace leaderboard: top-5 listed, the sentinel maps to 未分组.
    expect(html).toContain('project-a');
    expect(html).toContain('project-b');
    expect(html).toContain('5 会话 · 30 请求');
    // Totals row.
    expect(html).toContain('合计约');
  });

  it('caps the leaderboard at five workspaces', () => {
    const manyWorkspaces: DashboardReading = {
      ...READING,
      workspaces: Array.from({ length: 8 }, (_, i) => ({
        workspace: `/ws/${i}`,
        requests: 10 - i,
        prompt: 0,
        completion: 0,
        sessions: 1,
      })),
    };
    const html = renderToStaticMarkup(<DashboardCardView reading={manyWorkspaces} />);
    // Five workspace rows render (the 6th, 7th, 8th are dropped).
    const rows = html.match(/<li[^>]*class="[^"]*dashWorkspaceRow/g) ?? [];
    expect(rows).toHaveLength(5);
    // The heaviest workspace's leaf (`0`) is at the top; the 6th (`5`) is dropped.
    expect(html).toContain('>0<');
    expect(html).not.toContain('>5<');
  });

  it('renders the empty-days sparkline as all-empty bars (no requests anywhere)', () => {
    const empty: DashboardReading = {
      sessions: 0,
      totals: { requests: 0, prompt: 0, completion: 0 },
      days: [],
      workspaces: [],
    };
    // The wrapper HIDES when totals.requests === 0; the view still renders for
    // tests that mount it directly, and every sparkline bar carries data-empty.
    const html = renderToStaticMarkup(<DashboardCardView reading={empty} />);
    const bars = html.match(/data-empty=/g) ?? [];
    expect(bars.length).toBeGreaterThan(0);
  });
});

describe('DashboardCard wrapper', () => {
  it('hides while loading (no fetch result yet) — SSR runs the effect zero times', () => {
    // SSR does not flush effects, so reading stays undefined → the wrapper
    // renders nothing. This is the contract: a fresh mount paints no card
    // until the host answers.
    const html = renderToStaticMarkup(<DashboardCard />);
    expect(html).not.toContain('data-context-dashboard');
  });
});
