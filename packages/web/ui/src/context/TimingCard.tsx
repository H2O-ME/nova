/**
 * The 上下文 pane's timing card: per-request TTFT and response duration, the
 * two numbers a reader uses to spot a slow turn (a long queue before the first
 * token vs a long tail generating it).
 *
 * The data comes from the kernel's own `RunMeter` (`RequestTiming` joined onto
 * `ContextPoint.timing` by the fold), so the panel and the run-header never
 * disagree about how long a request took. The card is a summary table — one
 * row per request that has timing, newest-last to match the trend's reading
 * direction — and it HIDES itself when no point carries timing (an older log
 * predating the field, or a session that has not yet completed a request).
 *
 * Purposely no chart: the trend card already plots cost over time, and a
 * second axis would duplicate it. Two numeric columns + an average strip is
 * the one shape that answers "which turn was slow" without a redraw.
 */
import type { ContextPoint, ContextPointTiming } from '../types.js';
import { formatDuration } from '../format.js';
import css from './ContextView.module.css';

export interface TimingCardProps {
  /** The folded timeline; the card reads `points[i].timing`. */
  points: readonly ContextPoint[];
}

/** A row the table renders — derived once per point that has timing. */
interface TimingRow {
  /** 1-based request index, matching the trend card's `第 N 次请求` numbering. */
  index: number;
  /** Time to first token, or undefined when the request produced none. */
  ttftMs?: number;
  /** Total request wall time (finish - start), or undefined while unfinished. */
  durationMs?: number;
}

/** Derive TTFT (firstTokenAt - startedAt) from a timing record, if computable. */
function ttftOf(timing: ContextPointTiming): number | undefined {
  if (timing.firstTokenAt === undefined) return undefined;
  const ms = timing.firstTokenAt - timing.startedAt;
  return ms >= 0 ? ms : undefined;
}

/** Derive total duration (finishedAt - startedAt) from a timing record, if computable. */
function durationOf(timing: ContextPointTiming): number | undefined {
  if (timing.finishedAt === undefined) return undefined;
  const ms = timing.finishedAt - timing.startedAt;
  return ms >= 0 ? ms : undefined;
}

/** Build the row list — only points that carry timing become rows. */
function rowsOf(points: readonly ContextPoint[]): TimingRow[] {
  const rows: TimingRow[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const timing = points[i]!.timing;
    if (timing === undefined) continue;
    const ttftMs = ttftOf(timing);
    const durationMs = durationOf(timing);
    // Skip a point whose timing has neither field yet (a still-running request
    // where only startedAt is set): a row with two dashes reads as "no data",
    // which is a different statement than "request in flight".
    if (ttftMs === undefined && durationMs === undefined) continue;
    rows.push({ index: i + 1, ttftMs, durationMs });
  }
  return rows;
}

/** Average of the defined values in a list, or undefined when none are. */
function averageOf(values: readonly (number | undefined)[]): number | undefined {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v !== undefined) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : undefined;
}

export function TimingCard({ points }: TimingCardProps): JSX.Element {
  const rows = rowsOf(points);
  // The card hides itself when nothing has timing yet — an empty card is noise.
  if (rows.length === 0) return <></>;

  const avgTtft = averageOf(rows.map((r) => r.ttftMs));
  const avgDuration = averageOf(rows.map((r) => r.durationMs));

  return (
    <section className={css.card} data-context-timing="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>请求时序</h3>
        <span className={css.trailing}>{rows.length} 次请求</span>
      </header>
      <ul className={css.timingList}>
        {rows.map((row) => (
          <li key={row.index} className={css.timingRow}>
            <span className={css.timingIndex}>第 {row.index} 次</span>
            <span className={css.timingCell} data-tone="ttft">
              {row.ttftMs !== undefined ? formatDuration(row.ttftMs) : '—'}
            </span>
            <span className={css.timingCell} data-tone="duration">
              {row.durationMs !== undefined ? formatDuration(row.durationMs) : '—'}
            </span>
          </li>
        ))}
      </ul>
      {(avgTtft !== undefined || avgDuration !== undefined) && (
        <p className={css.timingSummary}>
          <span>平均</span>
          <span data-tone="ttft">TTFT {avgTtft !== undefined ? formatDuration(avgTtft) : '—'}</span>
          <span data-tone="duration">用时 {avgDuration !== undefined ? formatDuration(avgDuration) : '—'}</span>
        </p>
      )}
    </section>
  );
}
