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
import type { SessionTotals } from '../../../src/totals';

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
 * @param totals - the session's cumulative run numbers.
 * @returns the reading, or undefined when the session has no timed step yet.
 */
export function timePill(totals: SessionTotals): PillReading | undefined {
  const rate = modelThroughput(totals);
  const ttft = averageFirstToken(totals);
  const rows: StatRow[] = [];
  if (totals.llmMs > 0) rows.push({ label: 'LLM 时间', value: formatDuration(totals.llmMs) });
  if (totals.toolMs > 0) rows.push({ label: '工具时间', value: formatDuration(totals.toolMs) });
  if (ttft !== undefined) rows.push({ label: '首 token 平均（TTFT）', value: formatDuration(ttft) });
  if (rate !== undefined) rows.push({ label: '速度', value: `${rate.toFixed(0)} tok/s` });
  if (rows.length === 0) return undefined;
  const parts = [`${totals.runs} 轮`, `${totals.requests} 步`];
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
  rows.push({ label: '输入', value: formatTokens(totals.promptTokens) });
  if (totals.cachedTokens > 0) rows.push({ label: '缓存读取', value: formatTokens(totals.cachedTokens) });
  rows.push({ label: '输出', value: formatTokens(totals.completionTokens) });
  if (totals.retries > 0) rows.push({ label: '重试', value: `${totals.retries} 次` });
  const parts = [`${formatTokens(total)} tok`];
  if (hit !== undefined) parts.push(`缓存命中 ${hit}%`);
  return { text: parts.join(' · '), rows };
}