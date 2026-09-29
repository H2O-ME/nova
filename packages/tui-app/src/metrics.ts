/**
 * The two live readouts the shell measures itself: output speed and cache-hit
 * rate.
 *
 * Split out of `app.ts` because it is stateful bookkeeping with its own rules,
 * and the shell's job is terminal ownership and frame assembly — not bucket
 * arithmetic. Everything here is a pure function over an explicit state object,
 * so the behaviour that makes the numbers *stable* is testable without a clock:
 *
 *  - **The tps window is bucketed, and the readout is sticky-low.** A slow
 *    round trip must not blink the number to zero mid-turn, so a bucket that
 *    ages out only clears when nothing is running; while a turn is in flight the
 *    last measured speed stands. Same reasoning as the cache rate below.
 *  - **The cache rate is sticky, not per-request.** A gateway that routes some
 *    requests to a backend which does not report cache hits would otherwise make
 *    the field blink in and out mid-session.
 */
import type { UsageStats } from '@nova-agent/core';

/** One tps bucket's width. */
export const TPS_BUCKET_MS = 500;
/** How many buckets the window averages — 10 × 500ms = a 5s window. */
export const TPS_BUCKETS = 10;

/** The measured readouts, as the shell holds them. */
export interface Metrics {
  /** Bytes-equivalent per bucket; 4 chars ≈ 1 token. */
  tps: number[];
  /** When the newest bucket started (0 = not started yet). */
  tpsAt: number;
  tpsIndex: number;
  /** Last positive speed, kept so a thinking turn does not report zero. */
  lastTps: number;
  /** Sticky cache-hit fraction, or `null` before any usage has arrived. */
  cacheRate: number | null;
}

export function createMetrics(): Metrics {
  return {
    tps: Array.from({ length: TPS_BUCKETS }, (): number => 0),
    tpsAt: 0,
    tpsIndex: 0,
    lastTps: 0,
    cacheRate: null,
  };
}

/** Record streamed output. `chars` is 4 per token by the project's estimator. */
export function countOutput(metrics: Metrics, chars: number): void {
  metrics.tps[metrics.tpsIndex] = (metrics.tps[metrics.tpsIndex] ?? 0) + chars / 4;
}

/** The window's mean speed, tokens per second. */
function meanTps(metrics: Metrics): number {
  return metrics.tps.reduce((sum, value) => sum + value, 0) / ((TPS_BUCKETS * TPS_BUCKET_MS) / 1000);
}

/**
 * Roll the window forward to `now`, advancing as many buckets as have elapsed.
 * @param metrics - mutated in place (the shell owns one instance).
 * @param now - the current clock reading.
 * @param running - whether a turn is in flight, which decides whether an empty
 *   window clears the sticky value.
 */
export function rotateTps(metrics: Metrics, now: number, running: boolean): void {
  if (metrics.tpsAt === 0) {
    metrics.tpsAt = now;
    return;
  }
  let advanced = false;
  while (now - metrics.tpsAt >= TPS_BUCKET_MS) {
    metrics.tpsAt += TPS_BUCKET_MS;
    metrics.tpsIndex = (metrics.tpsIndex + 1) % TPS_BUCKETS;
    metrics.tps[metrics.tpsIndex] = 0;
    advanced = true;
  }
  if (!advanced) return;
  const perSecond = meanTps(metrics);
  if (perSecond > 0) metrics.lastTps = perSecond;
  else if (!running) metrics.lastTps = 0;
}

/** The speed to display, or `null` when there is nothing honest to show. */
export function currentTps(metrics: Metrics, running: boolean): number | null {
  const perSecond = meanTps(metrics);
  const value = perSecond > 0 ? perSecond : running ? metrics.lastTps : 0;
  return value > 0 ? value : null;
}

/**
 * Fold a usage snapshot into the sticky cache rate. A snapshot with no prompt
 * tokens is ignored rather than treated as a 0% hit — the field is absent, not
 * empty, when the gateway said nothing.
 */
export function refreshCacheRate(metrics: Metrics, stats: UsageStats): void {
  if (stats.promptTokens <= 0) return;
  metrics.cacheRate = Math.min(1, Math.max(0, stats.cachedTokens / stats.promptTokens));
}
