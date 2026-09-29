/**
 * The local-midnight boundary the message clock rides on. `formatClock` renders
 * `HH:mm` for today and widens to `M月D日 HH:mm` for anything older, so the day
 * seat must advance exactly at the calendar boundary — and a DST transition day
 * is 23 or 25 hours long, which a fixed `+ 86400000` would get wrong.
 *
 * No DOM here: the arithmetic is the whole of the risk, and the hook is a
 * `setTimeout` around it whose re-arm chain is three lines.
 */
import { describe, expect, it } from 'vitest';
import { msUntilNextLocalMidnight, startOfLocalDay } from '../src/chat/use-calendar-day.js';

const DAY = 24 * 3_600_000;

describe('startOfLocalDay', () => {
  it('lands on the containing day, not the previous one', () => {
    expect(startOfLocalDay(new Date(2026, 6, 29, 12, 0).getTime())).toBe(new Date(2026, 6, 29).getTime());
    // A millisecond before midnight is still that day.
    expect(startOfLocalDay(new Date(2026, 6, 29, 23, 59, 59, 999).getTime())).toBe(new Date(2026, 6, 29).getTime());
    // The first millisecond is already the new day.
    expect(startOfLocalDay(new Date(2026, 6, 30, 0, 0, 0, 0).getTime())).toBe(new Date(2026, 6, 30).getTime());
  });
});

describe('msUntilNextLocalMidnight', () => {
  it('counts to the boundary from an in-day instant', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 6, 29, 12, 0).getTime())).toBe(12 * 3_600_000);
    expect(msUntilNextLocalMidnight(new Date(2026, 6, 29, 23, 59).getTime())).toBe(60_000);
  });

  it('never returns zero, so the re-arm chain cannot spin', () => {
    // Exactly at the boundary the next one is a whole day away, never 0.
    expect(msUntilNextLocalMidnight(new Date(2026, 6, 29, 0, 0, 0, 0).getTime())).toBe(DAY);
    // Even a millisecond before it, the clamp keeps the delay positive.
    expect(msUntilNextLocalMidnight(new Date(2026, 6, 29, 23, 59, 59, 999).getTime())).toBe(1);
  });

  it('targets a real calendar boundary, so the day seat always advances', () => {
    // Every instant in one day resolves to the start of the NEXT day — this is
    // what makes the hook's re-fired `startOfLocalDay` report a new day, and it
    // is the invariant a DST transition must not break.
    for (const hour of [0, 6, 12, 18, 23]) {
      for (const minute of [0, 30]) {
        const from = new Date(2026, 6, 29, hour, minute).getTime();
        const target = from + msUntilNextLocalMidnight(from);
        expect(target).toBe(startOfLocalDay(target));
        expect(startOfLocalDay(target)).toBeGreaterThan(startOfLocalDay(from));
      }
    }
  });

  it('steps whole days across a run of ordinary days', () => {
    let cursor = new Date(2026, 6, 29, 9, 0).getTime();
    for (let step = 1; step <= 4; step += 1) {
      cursor += msUntilNextLocalMidnight(cursor);
      expect(cursor).toBe(new Date(2026, 6, 29 + step).getTime());
      expect(cursor).toBe(startOfLocalDay(cursor));
    }
  });
});
