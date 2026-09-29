/**
 * Local calendar-day epoch that advances at each local midnight — the
 * harness `ui-chat`'s `use-calendar-day.ts`.
 *
 * The message clock (`format.ts`'s `formatClock`) renders `HH:mm` for today
 * and adds the date for anything older, so a row mounted before midnight would
 * keep reading "today" forever without a seat that re-fires at the boundary.
 * The arithmetic below is the whole of that logic; the exported helpers exist
 * so its boundary behaviour is directly testable.
 */
import { useEffect, useState } from 'react';

/**
 * Midnight at the start of the local calendar day containing `ms`.
 * @param ms - any epoch millisecond.
 * @returns epoch ms of that day's local midnight.
 */
export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Delay from `ms` to the next local midnight (never zero). `setHours(24, …)`
 * is deliberately not `+ 86400000`: on a DST transition day the next local
 * midnight is 23 or 25 hours away, and this lands on the calendar boundary
 * either way (in a zone whose transition skips 00:00, on the first instant of
 * the new day, which is what `startOfLocalDay` then reports).
 * @param ms - the instant to measure from.
 * @returns milliseconds until the next local day begins.
 */
export function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms);
  next.setHours(24, 0, 0, 0);
  return Math.max(next.getTime() - ms, 1);
}

/**
 * The current local calendar day, re-rendering the caller once at each local
 * midnight.
 * @returns Epoch ms of the current day's midnight; advances after the boundary.
 */
export function useCalendarDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      const now = Date.now();
      setDay(startOfLocalDay(now));
      timer = setTimeout(arm, msUntilNextLocalMidnight(now));
    };
    timer = setTimeout(arm, msUntilNextLocalMidnight(Date.now()));
    return () => { clearTimeout(timer); };
  }, []);
  return day;
}
