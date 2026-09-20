/**
 * Number and duration formatting for the surface's stats rows (M11 批6).
 *
 * Pure and DOM-free so the reducer lane can assert it: every string the user
 * reads about time and tokens is produced here, in one place, from numbers a
 * surface already has. The vocabulary is deliberately terse (dsh-style):
 * `13m59s`, `5.6s`, `42 tok/s`, `4.1M`, `60%`.
 */
import type { SessionTotals } from './state.js';

/** `950ms` / `5.6s` / `13m59s` / `2h05m` — growing units, never a bare float. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m${String(totalSeconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

/** Token counts at a glance: `820`, `4.1K`, `4.1M`. */
export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Output tokens per second of a run, or undefined when it is not meaningful. */
export function throughput(stats: { completionTokens: number; durationMs: number }): number | undefined {
  if (stats.durationMs <= 0 || stats.completionTokens <= 0) return undefined;
  return stats.completionTokens / (stats.durationMs / 1_000);
}

/**
 * Session throughput over MODEL time (not wall clock): the same number as a
 * run's `tok/s` would give, asked of a session that spent much of its life
 * waiting on tools.
 */
export function modelThroughput(totals: SessionTotals): number | undefined {
  if (totals.llmMs <= 0 || totals.completionTokens <= 0) return undefined;
  return totals.completionTokens / (totals.llmMs / 1_000);
}

/**
 * Prompt-cache hit rate (cached / prompt tokens), or undefined when the
 * provider never reported caching at all — a backend without prefix caching
 * must not read as a permanent 0% miss (the same guard core's waste audit
 * applies).
 */
export function cacheHitRate(tokens: { promptTokens: number; cachedTokens: number }): number | undefined {
  if (tokens.promptTokens <= 0 || tokens.cachedTokens <= 0) return undefined;
  return (tokens.cachedTokens / tokens.promptTokens) * 100;
}

/** The average first-token latency across runs that reported one. */
export function averageFirstToken(totals: SessionTotals): number | undefined {
  if (totals.firstTokenRuns === 0) return undefined;
  return totals.firstTokenMs / totals.firstTokenRuns;
}

/**
 * One finished run's line: when it started, how long it took, how long the
 * user waited for the first token, and how fast it then streamed.
 */
export function runMetaText(stats: {
  startedAt: number;
  durationMs: number;
  firstTokenMs?: number;
  completionTokens: number;
}): string {
  const parts = [`用时 ${formatDuration(stats.durationMs)}`];
  if (stats.firstTokenMs !== undefined) parts.push(`首 token ${formatDuration(stats.firstTokenMs)}`);
  const rate = throughput(stats);
  if (rate !== undefined) parts.push(`${rate.toFixed(0)} tok/s`);
  return parts.join(' · ');
}

/** The session stats bar's segments, in reading order. */
export function sessionStatsText(totals: SessionTotals): string {
  const parts = [`${totals.runs} 轮`, `${totals.toolCalls} 步`];
  const timing: string[] = [];
  if (totals.llmMs > 0) timing.push(`LLM ${formatDuration(totals.llmMs)}`);
  if (totals.toolMs > 0) timing.push(`工具 ${formatDuration(totals.toolMs)}`);
  if (timing.length > 0) parts.push(timing.join(' · '));

  const latency: string[] = [];
  const firstToken = averageFirstToken(totals);
  if (firstToken !== undefined) latency.push(`首 token 平均 ${formatDuration(firstToken)}`);
  const rate = modelThroughput(totals);
  if (rate !== undefined) latency.push(`${rate.toFixed(0)} tok/s`);
  if (latency.length > 0) parts.push(latency.join(' · '));

  const hit = cacheHitRate(totals);
  if (hit !== undefined) parts.push(`缓存命中 ${hit.toFixed(0)}%`);
  parts.push(`输入 ${formatTokens(totals.promptTokens)} tok · 输出 ${formatTokens(totals.completionTokens)} tok`);
  if (totals.retries > 0) parts.push(`重试 ${totals.retries}`);
  return parts.join(' | ');
}

/** `8月28日 23:43` — the transcript's clock, local time. */
export function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
