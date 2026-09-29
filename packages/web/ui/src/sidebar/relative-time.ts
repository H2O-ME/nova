/**
 * A session row's trailing stamp, as a compact relative age.
 * Ported from deepseek-harness `ui-primitives/src/relative-time.ts` (bucketing)
 * plus the `workspace` namespace's `time.*` words, (c) 2026 DeepSeek — MIT
 * License.
 *
 * The reference never prints a wall clock in a session row: the buckets answer
 * "how stale is this", which is the question a list of sessions is scanned for,
 * and they stay short enough for a 280px column at any locale width. Bucketing
 * lives here, apart from the row, so the vitest lane can date a list without a
 * DOM and two surfaces naming the same session cannot disagree.
 */
import { SIDEBAR_COPY } from './view.js';

/** The magnitude of one relative-time bucket (`now` carries no number). */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years';

/** A row's age as a bucket plus its magnitude, before localization. */
export interface RelativeTime {
  unit: RelativeTimeUnit;
  n: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** dsh `relative-time.ts`: a "month" is 30 days and a "year" is 365. */
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

/**
 * The bucket a timestamp falls in, relative to `now`.
 * @param at - epoch ms of the dated moment.
 * @param now - current epoch ms (injected, so rendering stays pure).
 * @returns the bucket and its magnitude (0 for `now`).
 */
export function relativeTime(at: number, now: number): RelativeTime {
  // A clock that runs backwards (or a future mtime) reads as `now` rather than
  // as a negative age.
  const diff = Math.max(0, now - at);
  if (diff < MINUTE_MS) return { unit: 'now', n: 0 };
  if (diff < HOUR_MS) return { unit: 'minutes', n: Math.floor(diff / MINUTE_MS) };
  if (diff < DAY_MS) return { unit: 'hours', n: Math.floor(diff / HOUR_MS) };
  if (diff < MONTH_DAYS * DAY_MS) return { unit: 'days', n: Math.floor(diff / DAY_MS) };
  if (diff < YEAR_DAYS * DAY_MS) return { unit: 'months', n: Math.floor(diff / (MONTH_DAYS * DAY_MS)) };
  return { unit: 'years', n: Math.floor(diff / (YEAR_DAYS * DAY_MS)) };
}

/** The four localized forms the buckets read as (`{n}` is the magnitude). */
const TIME_WORDS: Record<Exclude<RelativeTimeUnit, 'now'>, string> = {
  minutes: SIDEBAR_COPY['time.minutes'],
  hours: SIDEBAR_COPY['time.hours'],
  days: SIDEBAR_COPY['time.days'],
  months: SIDEBAR_COPY['time.months'],
  years: SIDEBAR_COPY['time.years'],
};

/**
 * A session row's trailing stamp: `刚刚` / `5分钟` / `3小时` / `2天` / `4个月`
 * / `1年`, the reference's own words and buckets.
 * @param at - epoch ms of the session's last update.
 * @param now - current epoch ms (injected, so rendering stays pure).
 * @returns the localized stamp.
 */
export function relativeStamp(at: number, now: number): string {
  const { unit, n } = relativeTime(at, now);
  if (unit === 'now') return SIDEBAR_COPY['time.now'];
  // The reference's `time.ago` wrapper belongs to the hover card only; the row
  // cell reads bare.
  return TIME_WORDS[unit].replace('{n}', String(n));
}
