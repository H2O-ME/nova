/**
 * Number and duration formatting for the surface's stats rows (M11 批6).
 *
 * Pure and DOM-free so the reducer lane can assert it: every string the user
 * reads about time and tokens is produced here, in one place, from numbers a
 * surface already has. The vocabulary is deliberately terse (dsh-style):
 * `13m59s`, `5.6s`, `42 tok/s`, `4.1M`, `60%`.
 */
import type { SessionTotals } from '../../src/totals';

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

/** Token counts at a glance: `820`, `4.1K`, `42.3K`, `200K`, `4.1M` — one
 * decimal, dropped when it is a zero (a 200k window reads `200K`, not `200.0K`). */
export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${trimZero(count / 1_000)}K`;
  return `${trimZero(count / 1_000_000)}M`;
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
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
 * Prompt-cache hit text (cached / prompt), or undefined when the provider never
 * reported caching at all — a backend without prefix caching must not read as a
 * permanent 0% miss (the same guard core's waste audit applies).
 *
 * Ported from deepseek-harness `ui-chat/src/client/chat/token-format.ts`
 * (`formatCacheHitPercent`, MIT): a partial hit is NEVER rounded up to `100`,
 * because "缓存命中 100%" is a claim about the whole prompt that a 99.9% share
 * does not support. A ratio that would round to full precision instead reports
 * as many nines as it takes to stay under it (`99.999`); a true full hit is
 * `100`. The exact-arithmetic search is the reference's: it keeps the unit
 * boundaries exact for token counts far beyond double precision's comfort.
 * @param cachedTokens - exact prompt tokens served from cache.
 * @param promptTokens - exact aggregate prompt tokens.
 * @returns the percentage text, or undefined when there was no cache read.
 */
export function cacheHitText(cachedTokens: number, promptTokens: number): string | undefined {
  if (promptTokens <= 0 || cachedTokens <= 0) return undefined;
  const missed = promptTokens - cachedTokens;
  if (missed <= 0) return '100';

  const units = roundedPercentUnits(cachedTokens, promptTokens);
  if (units < 100) return String(units);

  // A ratio inside the last percent: report nines until the text is short of
  // the next full unit, so the string never claims a complete hit.
  let places = 1;
  let gap = missed * 200;
  const tens = Math.floor(promptTokens / 10);
  while (gap <= tens) {
    gap *= 10;
    places += 1;
  }
  const ones = promptTokens % 10;
  let loss = 5;
  for (let candidate = 1; candidate < 5; candidate += 1) {
    const factor = candidate * 2 + 1;
    if (gap <= factor * tens + Math.floor((factor * ones) / 10)) {
      loss = candidate;
      break;
    }
  }
  return `99.${'9'.repeat(places - 1)}${10 - loss}`;
}

/** Percentage units (hundredths of a percent rounded to whole units, ties up). */
function roundedPercentUnits(cachedTokens: number, promptTokens: number): number {
  const scale = 100;
  const doubled = scale * 2;
  const quotient = Math.floor(promptTokens / doubled);
  const remainder = promptTokens % doubled;
  let lower = 0;
  let upper = scale;
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2);
    const factor = candidate * 2 - 1;
    const threshold = factor * quotient + Math.ceil((factor * remainder) / doubled);
    if (cachedTokens >= threshold) lower = candidate;
    else upper = candidate - 1;
  }
  return lower;
}

/** The average first-token latency across runs that reported one. */
export function averageFirstToken(totals: SessionTotals): number | undefined {
  if (totals.firstTokenRuns === 0) return undefined;
  return totals.firstTokenMs / totals.firstTokenRuns;
}

/**
 * One finished run's line: when it started, how long it took, how long the
 * user waited for the first token, how fast it then streamed — plus the two
 * numbers that explain a run that felt slow (time spent in tools) or unlucky
 * (in-flight re-requests). Parts that are zero are dropped rather than printed
 * as `0 次`, so a plain answer reads as one short line.
 */
export function runMetaText(stats: {
  startedAt: number;
  durationMs: number;
  firstTokenMs?: number;
  toolCalls: number;
  toolMs: number;
  retries: number;
  completionTokens: number;
}): string {
  const parts = [`用时 ${formatDuration(stats.durationMs)}`];
  if (stats.firstTokenMs !== undefined) parts.push(`首 token ${formatDuration(stats.firstTokenMs)}`);
  const rate = throughput(stats);
  if (rate !== undefined) parts.push(`${rate.toFixed(0)} tok/s`);
  if (stats.toolCalls > 0) parts.push(`工具 ${stats.toolCalls} 次 ${formatDuration(stats.toolMs)}`);
  if (stats.retries > 0) parts.push(`重试 ${stats.retries}`);
  return parts.join(' · ');
}

/**
 * A nested subagent's totals. Deliberately separate from the parent's line:
 * the nested loop's tokens are its own consumption (the parent paid them as one
 * tool result), so they are reported as the child's numbers, not merged.
 */
export function subagentTotals(usage: {
  elapsedMs: number;
  turns: number;
  promptTokens: number;
  completionTokens: number;
}): string {
  const tokens = usage.promptTokens + usage.completionTokens;
  const parts = [`${usage.turns} 轮`, formatDuration(usage.elapsedMs)];
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`);
  return parts.join(' · ');
}

/** `8月28日 23:43` — the transcript's clock, local time. */
export function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * A session row's right-hand stamp, kept short enough for a 280px sidebar:
 * time of day for today's sessions, the date for everything older (the rows are
 * grouped by workspace, so the group label no longer carries the date).
 */
export function stampLabel(ms: number, now: number = Date.now()): string {
  const date = new Date(ms);
  const today = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (date.toDateString() === today.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * What an "always" grant pinned to the first `scope` words covers, as the user
 * will read it back in the approval dialog: the word prefix plus an ellipsis
 * when it stops short of the whole command. The words come from the kernel
 * (`ApprovalRequest.scopeWords`) — the surface never derives the rule itself.
 */
export function scopedGrant(words: readonly string[], scope: number): string {
  const head = words.slice(0, Math.max(1, Math.min(scope, words.length))).join(' ');
  return scope >= words.length ? head : `${head} …`;
}
