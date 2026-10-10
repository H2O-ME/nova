/**
 * The Token 统计 card's reading: the session's billed tokens split by WHAT they
 * are. Ported from dsh-context `components/statsTokens.tsx` and the
 * `billedParts` builder in its `categories.ts` (Apache-2.0).
 *
 * The total is the SAME figure the composer's usage pill prints — the session
 * totals the host folds over `run/stats` (`promptTokens` is BILLED input, which
 * already contains the cache reads) — so the pane and the composer cannot
 * disagree about what the session cost. Only the SPLIT is an estimate: the
 * prompt side is apportioned by the live window's own composition ratios (the
 * bar in the card right below), and the provider's exact completion count
 * closes the ring as its own slice. That is why the category rows carry the `≈`
 * marker and the output row does not.
 *
 * dsh prints `含思考` beside the output figure; Nova's kernel does not separate
 * reasoning tokens from completion tokens anywhere, so the note is dropped
 * rather than asserted (see `docs/dsh-parity-inventory.md`).
 */
import type { ContextTimeline } from '../types.js';
import type { SessionTotals } from '@nova-agent/core';
import { formatTokens } from '../format.js';
import { CATEGORY_COLOR, CATEGORY_ORDER, categoryLabel } from './context-model.js';
import type { DonutSlice } from './donut-model.js';

/** The ring's own slice for generated tokens: not a window category. */
const OUTPUT_KEY = 'output';
const OUTPUT_LABEL = '输出';
/**
 * dsh paints this slice pink; the token layer ported into `styles/` has no pink
 * ramp, so the nearest distinct static hue stands in (every other static 500 is
 * already spoken for by a window category).
 */
const OUTPUT_COLOR = 'var(--dsw-static-red-500)';

/** One legend row under the ring. */
export interface TokenStatRow {
  key: string;
  label: string;
  color: string;
  tokens: number;
  /** Share of the ring, preformatted (`68.7%`, `<1%`, `—` when nothing is billed). */
  pct: string;
  /** The muted second line: `≈415.3K`, or the exact figure for 输出. */
  count: string;
  /** A zero-weight row dims whole — the ring already carries the share. */
  dim: boolean;
}

/** The card's whole reading: the ring's slices and the legend rows, one order. */
export interface TokenStatsReading {
  slices: DonutSlice[];
  rows: TokenStatRow[];
  /** Billed total (prompt + completion); 0 when no provider usage was reported. */
  total: number;
  /** Whether any provider usage was reported at all. */
  reported: boolean;
}

/**
 * The share text: one decimal, dropped when it is a zero, and `<1%` for a
 * non-zero slice too small to round up — a wedge that reads `0%` claims the
 * ring has nothing there, which is exactly what it is drawing.
 */
function shareText(value: number, total: number): string {
  if (total <= 0) return '—';
  const pct = (value / total) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${(Math.round(pct * 10) / 10).toFixed(1).replace(/\.0$/, '')}%`;
}

/**
 * The prompt-side ratios: the live window's composition, falling back to the
 * newest request's when the live reading is empty (a resumed session whose fold
 * has not rebuilt its elements yet). An empty ratio table leaves the prompt side
 * unsplit rather than inventing an equal share.
 */
function promptRatios(timeline: ContextTimeline): Record<string, number> {
  const sources = [timeline.live.cats, timeline.points[timeline.points.length - 1]?.cats];
  for (const cats of sources) {
    if (cats === undefined) continue;
    let total = 0;
    for (const cat of CATEGORY_ORDER) total += cats[cat] ?? 0;
    if (total <= 0) continue;
    const ratios: Record<string, number> = {};
    for (const cat of CATEGORY_ORDER) ratios[cat] = (cats[cat] ?? 0) / total;
    return ratios;
  }
  return {};
}

/**
 * Read the card's numbers off the session totals and the timeline's ratios.
 * @param timeline - the fold's reading (the prompt-side ratios come from it).
 * @param totals - the session totals the composer's usage pill also reads.
 * @returns the ring's slices, the legend rows and the billed total.
 */
export function tokenStats(timeline: ContextTimeline, totals: SessionTotals): TokenStatsReading {
  const input = Math.max(0, totals.promptTokens);
  const output = Math.max(0, totals.completionTokens);
  const total = input + output;
  const ratios = promptRatios(timeline);
  const slices: DonutSlice[] = [];
  const rows: TokenStatRow[] = [];
  for (const cat of CATEGORY_ORDER) {
    const tokens = Math.round(input * (ratios[cat] ?? 0));
    slices.push({ key: cat, color: CATEGORY_COLOR[cat], value: tokens });
    rows.push({
      key: cat,
      label: categoryLabel(cat),
      color: CATEGORY_COLOR[cat],
      tokens,
      pct: shareText(tokens, total),
      count: `≈${formatTokens(tokens)}`,
      dim: tokens === 0,
    });
  }
  slices.push({ key: OUTPUT_KEY, color: OUTPUT_COLOR, value: output });
  rows.push({
    key: OUTPUT_KEY,
    label: OUTPUT_LABEL,
    color: OUTPUT_COLOR,
    tokens: output,
    pct: shareText(output, total),
    count: formatTokens(output),
    dim: output === 0,
  });
  return { slices, rows, total, reported: total > 0 };
}
