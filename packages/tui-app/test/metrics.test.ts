/**
 * The shell's own readouts: output speed and cache-hit rate.
 *
 * The behaviour worth pinning is the *stickiness*, because a naive
 * instantaneous calculation looks right in a unit test and blinks in a real
 * session. Both rules exist because the alternative was observed:
 *
 *  - a turn that is thinking or running a tool produces no output for seconds,
 *    so a plain window mean reads zero and the speed field flickers off and on;
 *  - a gateway that routes some requests to a backend which does not report
 *    cache hits makes the rate jump between a real fraction and absent.
 */
import { describe, expect, it } from 'vitest';
import type { UsageStats } from '@nova-agent/core';
import { countOutput, createMetrics, currentTps, refreshCacheRate, rotateTps } from '../src/metrics.js';

const usage = (promptTokens: number, cachedTokens: number): UsageStats =>
  ({ promptTokens, cachedTokens }) as UsageStats;

describe('output speed', () => {
  it('reports nothing before any output', () => {
    expect(currentTps(createMetrics(), false)).toBeNull();
  });

  it('converts streamed characters to tokens (4 chars per token)', () => {
    const metrics = createMetrics();
    countOutput(metrics, 400); // 100 tokens in the current bucket
    // The window is 5s wide, so one bucket of 100 tokens reads 20/s.
    expect(currentTps(metrics, true)).toBeCloseTo(20, 5);
  });

  it('keeps the last speed while a turn is running and the window empties', () => {
    // The blink this prevents: a tool call produces no output for seconds, so a
    // plain mean would read zero in the middle of a turn. Driven one bucket at a
    // time, the way the app's tick actually calls this.
    const metrics = createMetrics();
    countOutput(metrics, 400);
    rotateTps(metrics, 0, true);
    let clock = 1_000;
    for (let i = 0; i < 11; i++) {
      rotateTps(metrics, clock, true);
      clock += 500;
    }
    expect(currentTps(metrics, true)).toBeCloseTo(20, 5);
  });

  it('clears the speed once the turn ends and the window is empty', () => {
    const metrics = createMetrics();
    countOutput(metrics, 400);
    rotateTps(metrics, 0, true);
    let clock = 1_000;
    for (let i = 0; i < 11; i++) {
      rotateTps(metrics, clock, true);
      clock += 500;
    }
    expect(currentTps(metrics, true)).not.toBeNull();
    // One more bucket with the run over, and the stale speed is dropped.
    rotateTps(metrics, clock, false);
    expect(currentTps(metrics, false)).toBeNull();
  });

  it('advances one bucket per elapsed interval and wraps around', () => {
    const metrics = createMetrics();
    rotateTps(metrics, 0, true); // tpsAt === 0 is the "not started" sentinel
    rotateTps(metrics, 1_000, true);
    countOutput(metrics, 400);
    expect(metrics.tps[metrics.tpsIndex]).toBeCloseTo(100, 5);
    // Ten buckets wrap the index back to the one just written; it must be reset,
    // or a stale bucket would be counted as fresh output.
    rotateTps(metrics, 1_000 + 500 * 10, true);
    expect(metrics.tpsIndex).toBe(0);
    expect(metrics.tps[0]).toBe(0);
  });
});

describe('cache-hit rate', () => {
  it('is absent until a snapshot with prompt tokens arrives', () => {
    const metrics = createMetrics();
    expect(metrics.cacheRate).toBeNull();
    refreshCacheRate(metrics, usage(0, 0));
    expect(metrics.cacheRate).toBeNull();
  });

  it('is the cached fraction of the prompt', () => {
    const metrics = createMetrics();
    refreshCacheRate(metrics, usage(1_000, 900));
    expect(metrics.cacheRate).toBeCloseTo(0.9, 5);
  });

  it('stays put when a later snapshot reports nothing', () => {
    // A gateway that routes some requests to a backend which does not report
    // cache hits must not blank the field mid-session.
    const metrics = createMetrics();
    refreshCacheRate(metrics, usage(1_000, 900));
    refreshCacheRate(metrics, usage(0, 0));
    expect(metrics.cacheRate).toBeCloseTo(0.9, 5);
  });

  it('clamps a nonsensical fraction into 0..1', () => {
    const metrics = createMetrics();
    refreshCacheRate(metrics, usage(100, 500));
    expect(metrics.cacheRate).toBe(1);
  });
});
