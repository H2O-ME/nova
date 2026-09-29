/**
 * The session row's trailing stamp: the reference's relative-time buckets and
 * their zh words. Bucketing is the part a rendered row cannot be asked about
 * (it depends on the clock a browser supplies), so it is asserted here as a
 * pure function over an injected `now`.
 */
import { describe, expect, it } from 'vitest';
import { relativeStamp, relativeTime } from '../src/sidebar/relative-time.js';
import { SIDEBAR_COPY } from '../src/sidebar/view.js';

/** A fixed "now" so every case is arithmetic rather than a race with the clock. */
const NOW = new Date(2026, 8, 21, 15, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('buckets by the reference thresholds', () => {
    expect(relativeTime(NOW, NOW).unit).toBe('now');
    expect(relativeTime(NOW - MINUTE, NOW)).toEqual({ unit: 'minutes', n: 1 });
    expect(relativeTime(NOW - 59 * MINUTE, NOW)).toEqual({ unit: 'minutes', n: 59 });
    expect(relativeTime(NOW - HOUR, NOW)).toEqual({ unit: 'hours', n: 1 });
    expect(relativeTime(NOW - 23 * HOUR, NOW)).toEqual({ unit: 'hours', n: 23 });
    expect(relativeTime(NOW - DAY, NOW)).toEqual({ unit: 'days', n: 1 });
    expect(relativeTime(NOW - 29 * DAY, NOW)).toEqual({ unit: 'days', n: 29 });
    // 30 days is where `days` hands over to `months`.
    expect(relativeTime(NOW - 30 * DAY, NOW)).toEqual({ unit: 'months', n: 1 });
    expect(relativeTime(NOW - 364 * DAY, NOW)).toEqual({ unit: 'months', n: 12 });
    expect(relativeTime(NOW - 365 * DAY, NOW)).toEqual({ unit: 'years', n: 1 });
  });

  it('never reports a negative age for a future timestamp', () => {
    // A clock that steps backwards (or an mtime in the future) must read as
    // "now", not as a negative count.
    expect(relativeTime(NOW + 5 * DAY, NOW)).toEqual({ unit: 'now', n: 0 });
  });
});

describe('relativeStamp', () => {
  it('renders each bucket through the dictionary, never the wire name', () => {
    expect(relativeStamp(NOW, NOW)).toBe(SIDEBAR_COPY['time.now']);
    // The unit words carry `{n}`, which the stamp fills in.
    expect(relativeStamp(NOW - 5 * MINUTE, NOW)).toBe(SIDEBAR_COPY['time.minutes'].replace('{n}', '5'));
    expect(relativeStamp(NOW - 3 * HOUR, NOW)).toBe(SIDEBAR_COPY['time.hours'].replace('{n}', '3'));
    expect(relativeStamp(NOW - 2 * DAY, NOW)).toBe(SIDEBAR_COPY['time.days'].replace('{n}', '2'));
    expect(relativeStamp(NOW - 40 * DAY, NOW)).toBe(SIDEBAR_COPY['time.months'].replace('{n}', '1'));
    expect(relativeStamp(NOW - 400 * DAY, NOW)).toBe(SIDEBAR_COPY['time.years'].replace('{n}', '1'));
  });

  it('leaves no unfilled placeholder behind', () => {
    for (const age of [MINUTE, HOUR, DAY, 30 * DAY, 365 * DAY]) {
      expect(relativeStamp(NOW - age, NOW)).not.toContain('{n}');
    }
  });
});
