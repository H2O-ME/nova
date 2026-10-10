/**
 * The composer's session statistics: which pills a session earns, what each
 * pill reads, and the rule that a figure with no data yet is omitted rather
 * than rendered as a zero (`0.0 tok/s`, `NaN%`, a `0ms` row). The numbers
 * themselves come from `format.ts`; this lane pins the composition.
 */
import { describe, expect, it } from 'vitest';
import { timePill, usagePill } from '../src/composer/stats-model.js';
import { emptyTotals, type SessionTotals } from '@nova-agent/core';

function totals(overrides: Partial<SessionTotals>): SessionTotals {
  return { ...emptyTotals, ...overrides };
}

describe('the composer stats pills', () => {
  it('a fresh session has no pills at all', () => {
    expect(timePill(emptyTotals)).toBeUndefined();
    expect(usagePill(emptyTotals)).toBeUndefined();
  });

  it('the gauge pill reads turns and steps, and opens onto the timed rows', () => {
    const pill = timePill(
      totals({
        runs: 3,
        requests: 7,
        llmMs: 12_500,
        toolMs: 900,
        firstTokenMs: 2_800,
        firstTokenRuns: 2,
        completionTokens: 600,
      }),
    );
    // Counts read as one figure (`1 轮 1 步`), the `·` spent only before the
    // speed — the reference's `stats.counts` template.
    expect(pill?.text).toBe('3 轮 7 步 · 48 tok/s');
    expect(pill?.rows).toEqual([
      { label: 'LLM 时间', value: '12.5s' },
      { label: '工具时间', value: '900ms' },
      { label: '首 token 平均（TTFT）', value: '1.4s' },
      { label: '速度', value: '48 tok/s' },
    ]);
  });

  it('omits the rows a session never measured, and the speed with them', () => {
    const pill = timePill(totals({ runs: 1, requests: 1, llmMs: 500 }));
    expect(pill?.text).toBe('1 轮 1 步');
    expect(pill?.rows).toEqual([{ label: 'LLM 时间', value: '500ms' }]);
  });

  // An endpoint that ignores `stream_options.include_usage` yields no `usage`
  // event at all, so the meter never closes `llmMs` and no token counter moves
  // (`packages/ai/src/client.ts` emits `usage` only when the chunk carries it).
  // Turns and steps still arrive via `run_stats`. The counts are the pill's own
  // reading and must survive the missing measurements: gating them behind the
  // timed rows hid the whole row — including the cache/usage pill, which has no
  // tokens to report — which is the reported "statistics disappeared" bug.
  it('reads turns and steps even when no usage ever arrived', () => {
    const pill = timePill(totals({ runs: 2, requests: 3 }));
    expect(pill?.text).toBe('2 轮 3 步');
    expect(pill?.rows).toEqual([]);
    expect(usagePill(totals({ runs: 2, requests: 3 }))).toBeUndefined();
  });

  // promptTokens is BILLED input (it already includes the cache reads), so the
  // row must be the disjoint 未缓存输入 — naming it 输入 put a value above a
  // 缓存读取 row that CONTAINED it, and disagreed with Nova's own turn panel
  // (TurnUsagePill) over the same number.
  it('the database pill splits billed input into uncached and cache-read halves', () => {
    const pill = usagePill(totals({ promptTokens: 24_000, cachedTokens: 21_600, completionTokens: 600 }));
    expect(pill?.text).toBe('24.6K tok · 缓存命中 90%');
    expect(pill?.rows).toEqual([
      { label: '缓存命中', value: '90%' },
      { label: '未缓存输入', value: '2.4K' },
      { label: '缓存读取', value: '21.6K' },
      { label: '输出', value: '600' },
    ]);
  });

  it('reads a 0% share when input was billed but nothing came from cache', () => {
    const pill = usagePill(totals({ promptTokens: 1_200, completionTokens: 40 }));
    expect(pill?.text).toBe('1.2K tok · 缓存命中 0%');
    expect(pill?.rows.map((row) => row.label)).toEqual(['缓存命中', '未缓存输入', '输出']);
  });

  it('counts the retry line only when the loop re-requested', () => {
    const pill = usagePill(totals({ promptTokens: 900, completionTokens: 100, retries: 2 }));
    expect(pill?.rows.at(-1)).toEqual({ label: '重试', value: '2 次' });
  });
});