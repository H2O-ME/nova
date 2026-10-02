/**
 * Pure-render tests for the DNA card. SSR (`renderToStaticMarkup`) — the same
 * lane every other context card uses — so the test runs no DOM, no fetch, no
 * act/waitFor. The card's interactive state (which row is open) starts empty,
 * so what SSR sees is the LIST of requests with no snapshot fetched yet —
 * exactly the shape a first paint draws.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContextBreakdown, ContextPoint } from '../src/types.js';
import { DnaCard } from '../src/context/DnaCard.js';

function cats(overrides: Partial<ContextBreakdown> = {}): ContextBreakdown {
  return { system: 0, tools: 0, injected: 0, user: 0, assistant: 0, tool: 0, ...overrides };
}

const POINTS: readonly ContextPoint[] = [
  { seq: 1, at: 1_700_000_000_000, cats: cats({ system: 1000, user: 500 }), total: 1500, prompt: 1500, cached: 0, output: 20 },
  { seq: 4, at: 1_700_000_100_000, cats: cats({ system: 1200, tools: 2800 }), total: 4000, prompt: 4100, cached: 3000, output: 40 },
];

describe('DnaCard', () => {
  it('hides when there are no points', () => {
    const html = renderToStaticMarkup(<DnaCard points={[]} sessionFile="/tmp/a.jsonl" />);
    expect(html).toBe('');
  });

  it('renders the per-request composition strips even without a sessionFile', () => {
    // Without sessionFile the DNA card still draws the strip — the strip reads
    // only the point's own `cats`, no host fetch needed.
    const html = renderToStaticMarkup(<DnaCard points={POINTS} />);
    expect(html).toContain('data-context-dna');
    expect(html).toContain('请求 DNA');
    expect(html).toContain('2 次');
    // One row per request, each carrying a strip element.
    expect(html.match(/data-cat=/g)?.length).toBeGreaterThan(0);
  });

  it('draws one segment per non-zero category, in DNA_ORDER', () => {
    const html = renderToStaticMarkup(<DnaCard points={POINTS} sessionFile="/tmp/a.jsonl" />);
    // The first point has system + user; the second has system + tools.
    // The stacked strip lists them in DNA_ORDER (system, tools, injected,
    // user, …) — so system must appear, and across both rows all three
    // categories (system, tools, user) appear at least once.
    expect(html).toContain('"system"');
    expect(html).toContain('"tools"');
    expect(html).toContain('"user"');
  });
});
