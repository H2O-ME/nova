/**
 * The composer's session statistics, as data: which pills exist, what each
 * pill's one-line reading says, and the rows its dialog opens onto. Pure and
 * DOM-free, so the numbers the user reads are asserted without a DOM (the
 * component only projects these strings).
 *
 * The split into two pills is the harness's (`ui-chat` StatsPills, MIT): a
 * gauge pill for time and speed, a database pill for tokens and cache. The
 * numbers are ours: every figure is a sum of the kernel's `run_stats` events
 * (`state.totals`), and the surface measures nothing itself.
 *
 * Semantics worth naming, because they are read off the kernel's meter rather
 * than assumed here:
 *  - 轮 = completed runs (`runs`), 步 = provider requests inside them
 *    (`requests`, the loop's iterations — the harness's "steps").
 *  - 缓存读取 is `cachedTokens`, a SUBSET of `promptTokens` (billed input), so
 *    the usage pill's total is input + output, never adding the two prompt-side
 *    buckets together.
 */
import {
  averageFirstToken,
  cacheHitText,
  formatDuration,
  formatTokens,
  modelThroughput,
} from '../format.js';
import type { SessionTotals } from '@nova-agent/core';

/** One label/value line of a pill's dialog. */
export interface StatRow {
  label: string;
  value: string;
}

/** What one pill reads and what it opens onto. */
export interface PillReading {
  /** The trigger's one-line reading. */
  text: string;
  /** The dialog's rows, in reading order. */
  rows: StatRow[];
}

/**
 * The gauge pill: turns and steps, plus the session's decode speed.
 *
 * The counts are the pill's OWN reading and are never gated on the timed rows:
 * a run that reported no `usage` (an endpoint that ignores
 * `stream_options.include_usage` yields none at all, so the meter never closes
 * `llmMs` and no token counter moves) still has turns and steps — they come
 * from `run_stats`, not from the provider. Gating the counts behind
 * `rows.length > 0` therefore discarded the one figure that was always known,
 * and the session-wide row vanished whole. Missing measurements mean this pill
 * has no time reading, not that the session has no statistics.
 * @param totals - the session's cumulative run numbers.
 * @returns the reading, or undefined when the session has not run at all.
 */
export function timePill(totals: SessionTotals): PillReading | undefined {
  // The only true empty state: nothing has run yet, so there is no count to
  // read. `requests` is checked alongside `runs` because a run that failed
  // before its first request still closes a run.
  if (totals.runs === 0 && totals.requests === 0) return undefined;
  const rate = modelThroughput(totals);
  const ttft = averageFirstToken(totals);
  const rows: StatRow[] = [];
  if (totals.llmMs > 0) rows.push({ label: 'LLM 时间', value: formatDuration(totals.llmMs) });
  if (totals.toolMs > 0) rows.push({ label: '工具时间', value: formatDuration(totals.toolMs) });
  if (ttft !== undefined) rows.push({ label: '首 token 平均（TTFT）', value: formatDuration(ttft) });
  if (rate !== undefined) rows.push({ label: '速度', value: `${rate.toFixed(0)} tok/s` });
  // The counts are one reading, not two: the reference's `stats.counts`
  // template joins turns and steps with a space and spends the `·` only
  // before the speed — `1 轮 1 步 · 92 tok/s`.
  const parts = [`${totals.runs} 轮 ${totals.requests} 步`];
  if (rate !== undefined) parts.push(`${rate.toFixed(0)} tok/s`);
  return { text: parts.join(' · '), rows };
}

/**
 * The database pill: billed tokens and the cache-hit share.
 * @param totals - the session's cumulative run numbers.
 * @returns the reading, or undefined when nothing was ever billed.
 */
export function usagePill(totals: SessionTotals): PillReading | undefined {
  const hit = cacheHitText(totals.cachedTokens, totals.promptTokens);
  const total = totals.promptTokens + totals.completionTokens;
  if (total <= 0) return undefined;
  const rows: StatRow[] = [];
  if (hit !== undefined) rows.push({ label: '缓存命中', value: `${hit}%` });
  // `promptTokens` is BILLED input — it already contains the cache reads, so
  // labelling it `输入` next to a `缓存读取` row showed a value that contains the
  // row beneath it. `未缓存输入` is the disjoint half, which is both what dsh
  // prints in this slot and what Nova's own turn panel prints (`TurnUsagePill`),
  // so one session cannot describe the same number two ways.
  const uncached = Math.max(0, totals.promptTokens - totals.cachedTokens);
  rows.push({ label: '未缓存输入', value: formatTokens(uncached) });
  if (totals.cachedTokens > 0) rows.push({ label: '缓存读取', value: formatTokens(totals.cachedTokens) });
  rows.push({ label: '输出', value: formatTokens(totals.completionTokens) });
  if (totals.retries > 0) rows.push({ label: '重试', value: `${totals.retries} 次` });
  const parts = [`${formatTokens(total)} tok`];
  if (hit !== undefined) parts.push(`缓存命中 ${hit}%`);
  return { text: parts.join(' · '), rows };
}