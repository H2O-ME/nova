/**
 * The composer's session statistics: which pills a session earns, what each
 * pill reads, and the rule that a figure with no data yet is omitted rather
 * than rendered as a zero (`0.0 tok/s`, `NaN%`, a `0ms` row). The numbers
 * themselves come from `format.ts`; this lane pins the composition.
 */
import { describe, expect, it } from 'vitest';
import { timePill, usagePill } from '../src/composer/stats-model.js';
import { emptyTotals, type SessionTotals } from '../../src/totals.js';

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
    expect(pill?.text).toBe('3 轮 · 7 步 · 48 tok/s');
    expect(pill?.rows).toEqual([
      { label: 'LLM 时间', value: '12.5s' },
      { label: '工具时间', value: '900ms' },
      { label: '首 token 平均（TTFT）', value: '1.4s' },
      { label: '速度', value: '48 tok/s' },
    ]);
  });

  it('omits the rows a session never measured, and the speed with them', () => {
    const pill = timePill(totals({ runs: 1, requests: 1, llmMs: 500 }));
    expect(pill?.text).toBe('1 轮 · 1 步');
    expect(pill?.rows).toEqual([{ label: 'LLM 时间', value: '500ms' }]);
  });

  it('the database pill reads billed tokens and the cache share', () => {
    const pill = usagePill(totals({ promptTokens: 24_000, cachedTokens: 21_600, completionTokens: 600 }));
    expect(pill?.text).toBe('24.6K tok · 缓存命中 90%');
    expect(pill?.rows).toEqual([
      { label: '缓存命中', value: '90%' },
      { label: '输入', value: '24K' },
      { label: '缓存读取', value: '21.6K' },
      { label: '输出', value: '600' },
    ]);
  });

  it('reports no cache row when the provider never cached (not a permanent 0%)', () => {
    const pill = usagePill(totals({ promptTokens: 1_200, completionTokens: 40 }));
    expect(pill?.text).toBe('1.2K tok');
    expect(pill?.rows.map((row) => row.label)).toEqual(['输入', '输出']);
  });

  it('counts the retry line only when the loop re-requested', () => {
    const pill = usagePill(totals({ promptTokens: 900, completionTokens: 100, retries: 2 }));
    expect(pill?.rows.at(-1)).toEqual({ label: '重试', value: '2 次' });
  });
});