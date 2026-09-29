/**
 * The surface's number formatting (M11 批6): every duration, token count and
 * rate the user reads is produced by these functions, so they are asserted
 * directly instead of being verified through a rendered row.
 */
import { describe, expect, it } from 'vitest';
import { averageFirstToken, cacheHitText, formatClock, formatDuration, formatExactTokens, formatTokens, liveDurationText, modelThroughput, runDurationText, runMetaText, scopedGrant, stampLabel, subagentTotals, throughput } from '../src/format.js';
import { emptyTotals, type SessionTotals } from '../../src/totals.js';

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
    expect(formatTokens(200_000)).toBe('200K');
    expect(formatTokens(4_100_000)).toBe('4.1M');
  });
});

describe('stampLabel', () => {
  it('shows the time of day for today, the date for anything older', () => {
    const now = new Date(2026, 8, 21, 15, 0, 0).getTime();
    expect(stampLabel(new Date(2026, 8, 21, 9, 5).getTime(), now)).toBe('09:05');
    expect(stampLabel(new Date(2026, 8, 3, 9, 5).getTime(), now)).toBe('9月3日');
    expect(stampLabel(new Date(2025, 11, 30, 9, 5).getTime(), now)).toBe('2025-12-30');
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

  it('reads 0 when input was billed but nothing was served from cache', () => {
    expect(cacheHitText(0, 0)).toBeUndefined();
    // Billed input with no cache reads is an honest 0% (the reference's rule):
    // the endpoints this surface targets report cache on every request, so a
    // standing 0% says "check your gateway", not "caching is invisible".
    expect(cacheHitText(0, 1_000)).toBe('0');
    expect(cacheHitText(120, 200)).toBe('60');
  });

  it('never rounds a partial cache hit up to a full one', () => {
    expect(cacheHitText(1_000, 1_000)).toBe('100');
    // 99.96% would read as a complete hit at integer precision: the text keeps
    // as much precision as it takes to stay short of 100 (the harness's rule).
    expect(cacheHitText(999, 1_000)).toBe('99.9');
    expect(cacheHitText(9_996, 10_000)).toBe('99.96');
    expect(cacheHitText(9_999, 10_000)).toBe('99.99');
    expect(cacheHitText(99_999, 100_000)).toBe('99.999');
  });

  it('averages first-token latency over the runs that reported one', () => {
    const totals: SessionTotals = { ...emptyTotals, firstTokenMs: 22_400, firstTokenRuns: 2 };
    expect(averageFirstToken(totals)).toBe(11_200);
    expect(averageFirstToken(emptyTotals)).toBeUndefined();
  });
});

describe('runMetaText', () => {
  it('says when, how long, how long the wait was, and how fast', () => {
    const text = runMetaText({
      startedAt: 1_700_000_000_000,
      durationMs: 30_000,
      firstTokenMs: 5_600,
      toolCalls: 0,
      toolMs: 0,
      retries: 0,
      completionTokens: 1_260,
    });
    expect(text).toBe('用时 30.0s · 首 token 5.6s · 42 tok/s');
  });

  it('omits the pieces the provider never reported', () => {
    expect(
      runMetaText({ startedAt: 0, durationMs: 2_000, toolCalls: 0, toolMs: 0, retries: 0, completionTokens: 0 }),
    ).toBe('用时 2.0s');
  });

  it('explains a slow or unlucky run with tool time and re-requests', () => {
    const text = runMetaText({
      startedAt: 0,
      durationMs: 12_000,
      toolCalls: 4,
      toolMs: 9_400,
      retries: 1,
      completionTokens: 120,
    });
    expect(text).toBe('用时 12.0s · 10 tok/s · 工具 4 次 9.4s · 重试 1');
  });
});

describe('subagentTotals', () => {
  it('reports the nested loop’s own rounds, wall time and tokens', () => {
    expect(subagentTotals({ elapsedMs: 21_400, turns: 3, promptTokens: 12_000, completionTokens: 800 })).toBe(
      '3 轮 · 21.4s · 12.8K tok',
    );
  });

  it('drops the token segment when the nested loop reported none', () => {
    expect(subagentTotals({ elapsedMs: 900, turns: 1, promptTokens: 0, completionTokens: 0 })).toBe('1 轮 · 900ms');
  });
});

describe('formatClock', () => {
  it('prints a local wall-clock stamp', () => {
    const ts = new Date(2026, 7, 28, 23, 43).getTime();
    expect(formatClock(ts)).toBe('8月28日 23:43');
  });

  it('shortens to the wall clock for today (the harness formatMessageClock rule)', () => {
    const now = new Date(2026, 8, 25, 10, 0).getTime();
    expect(formatClock(new Date(2026, 8, 25, 1, 54).getTime(), now)).toBe('01:54');
    expect(formatClock(new Date(2026, 8, 24, 1, 54).getTime(), now)).toBe('9月24日 01:54');
    expect(formatClock(new Date(2025, 8, 24, 1, 54).getTime(), now)).toBe('2025-09-24 01:54');
  });
});

describe('runDurationText', () => {
  it('grows whole units, never a bare float', () => {
    expect(runDurationText(4_000)).toBe('4秒');
    expect(runDurationText(2 * 60_000 + 30_000)).toBe('2分30秒');
    expect(runDurationText(3_600_000 + 2 * 60_000 + 5_000)).toBe('1小时02分05秒');
  });
});

describe('liveDurationText', () => {
  it('ticks whole seconds without zero padding', () => {
    expect(liveDurationText(59_400)).toBe('59秒');
    expect(liveDurationText(61_000)).toBe('1分1秒');
  });
});

describe('formatExactTokens', () => {
  it('groups thousands for the usage panel', () => {
    expect(formatExactTokens(23992)).toBe('23,992');
    expect(formatExactTokens(217)).toBe('217');
  });
});

describe('scopedGrant', () => {
  it('shows the word prefix an "always" grant would pin', () => {
    const words = ['git', 'status', '-sb'];
    expect(scopedGrant(words, 1)).toBe('git …');
    expect(scopedGrant(words, 2)).toBe('git status …');
  });

  it('drops the ellipsis when the scope covers the whole command', () => {
    expect(scopedGrant(['git', 'status'], 2)).toBe('git status');
  });

  it('clamps a scope the caller got wrong instead of rendering nothing', () => {
    expect(scopedGrant(['git', 'status'], 99)).toBe('git status');
    expect(scopedGrant(['git', 'status'], 0)).toBe('git …');
    // No words at all (a non-execute call, or a compound command): the surface
    // shows nothing rather than a dangling ellipsis.
    expect(scopedGrant([], 3)).toBe('');
  });
});
