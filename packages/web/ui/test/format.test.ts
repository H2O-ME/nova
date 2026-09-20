/**
 * The surface's number formatting (M11 批6): every duration, token count and
 * rate the user reads is produced by these functions, so they are asserted
 * directly instead of being verified through a rendered row.
 */
import { describe, expect, it } from 'vitest';
import { averageFirstToken, cacheHitRate, formatClock, formatDuration, formatTokens, modelThroughput, runMetaText, sessionStatsText, throughput } from '../src/format.js';
import { emptyTotals, type SessionTotals } from '../src/state.js';

describe('formatDuration', () => {
  it('grows through the units without ever printing a bare float', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(950)).toBe('950ms');
    expect(formatDuration(5_600)).toBe('5.6s');
    expect(formatDuration(59_400)).toBe('59.4s');
    expect(formatDuration(839_000)).toBe('13m59s');
    expect(formatDuration(7_500_000)).toBe('2h05m');
  });
});

describe('formatTokens', () => {
  it('summarises at a glance', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(820)).toBe('820');
    expect(formatTokens(4_100)).toBe('4.1K');
    expect(formatTokens(4_100_000)).toBe('4.1M');
  });
});

describe('rates', () => {
  it('reports throughput only when the run actually produced tokens', () => {
    expect(throughput({ completionTokens: 42, durationMs: 1_000 })).toBe(42);
    expect(throughput({ completionTokens: 0, durationMs: 1_000 })).toBeUndefined();
    expect(throughput({ completionTokens: 42, durationMs: 0 })).toBeUndefined();
  });

  it('keeps the session rate over MODEL time, not wall clock', () => {
    // 31m of wall clock, 20m of it in tools: the rate reflects the model's work.
    const totals: SessionTotals = { ...emptyTotals, completionTokens: 60_000, llmMs: 60_000, toolMs: 1_200_000 };
    expect(modelThroughput(totals)).toBe(1_000);
    expect(modelThroughput(emptyTotals)).toBeUndefined();
  });

  it('ignores a cache report that never arrived', () => {
    expect(cacheHitRate({ promptTokens: 0, cachedTokens: 0 })).toBeUndefined();
    expect(cacheHitRate({ promptTokens: 200, cachedTokens: 120 })).toBe(60);
  });

  it('averages first-token latency over the runs that reported one', () => {
    const totals: SessionTotals = { ...emptyTotals, firstTokenMs: 22_400, firstTokenRuns: 2 };
    expect(averageFirstToken(totals)).toBe(11_200);
    expect(averageFirstToken(emptyTotals)).toBeUndefined();
  });
});

describe('runMetaText', () => {
  it('says when, how long, how long the wait was, and how fast', () => {
    const text = runMetaText({ startedAt: 1_700_000_000_000, durationMs: 30_000, firstTokenMs: 5_600, completionTokens: 1_260 });
    expect(text).toBe('用时 30.0s · 首 token 5.6s · 42 tok/s');
  });

  it('omits the pieces the provider never reported', () => {
    expect(runMetaText({ startedAt: 0, durationMs: 2_000, completionTokens: 0 })).toBe('用时 2.0s');
  });
});

describe('sessionStatsText', () => {
  it('reads as one line of session facts', () => {
    const totals: SessionTotals = {
      runs: 5,
      requests: 82,
      toolCalls: 82,
      retries: 2,
      llmMs: 1_871_000,
      toolMs: 1_255_000,
      firstTokenMs: 56_000,
      firstTokenRuns: 5,
      promptTokens: 4_100_000,
      completionTokens: 42_300,
      cachedTokens: 2_460_000,
    };
    expect(sessionStatsText(totals)).toBe(
      '5 轮 | 82 步 | LLM 31m11s · 工具 20m55s | 首 token 平均 11.2s · 23 tok/s | 缓存命中 60% | 输入 4.1M tok · 输出 42.3K tok | 重试 2',
    );
  });

  it('leaves out what never happened', () => {
    expect(sessionStatsText({ ...emptyTotals, runs: 1, requests: 1, toolCalls: 0, llmMs: 900, promptTokens: 10, completionTokens: 2, cachedTokens: 0 })).toBe(
      '1 轮 | 0 步 | LLM 900ms | 2 tok/s | 输入 10 tok · 输出 2 tok',
    );
  });
});

describe('formatClock', () => {
  it('prints a local wall-clock stamp', () => {
    const ts = new Date(2026, 7, 28, 23, 43).getTime();
    expect(formatClock(ts)).toBe('8月28日 23:43');
  });
});
