/**
 * The session stats bar (M11 批6): what this session has cost so far.
 *
 * Every number here is a sum of the kernel's `run_stats` events — the browser
 * measures nothing itself. It sits in the bottom chrome (above the composer)
 * because it is session-wide, not part of the transcript's story; a session
 * that has not run yet shows nothing at all rather than a row of zeros.
 */
import { sessionStatsText } from './format.js';
import type { SessionTotals } from './state.js';

export function StatsBar({ totals, busy }: { totals: SessionTotals; busy: boolean }): JSX.Element | null {
  if (totals.runs === 0 && !busy) return null;
  return (
    <div className="border-t border-[#1f1f27] px-6 py-1">
      <div className="mx-auto w-full max-w-3xl truncate font-mono text-[11px] text-[#6c6c76]">
        {sessionStatsText(totals)}
      </div>
    </div>
  );
}
