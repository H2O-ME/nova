/**
 * The Context pane's trend reading: one bar per completed request, each stacked
 * by category, all heights sharing one scale.
 *
 * Split from `context-model.ts` because it answers a different question — how
 * the window GREW, over the requests that produced it — and because the chart's
 * shape (bar heights, stack order, axis ticks) is a decision a reader should be
 * able to check without the composition card in the way.
 */
import type { ContextCategory, ContextPoint } from '../types.js';
import { formatTokens } from '../format.js';
import { CATEGORY_COLOR, CATEGORY_ORDER, categoryLabel, percentOf } from './context-model.js';

/** One category's slice of a single request's bar, stacked bottom-up. */
export interface TrendSegment {
  cat: ContextCategory;
  label: string;
  color: string;
  tokens: number;
  /** Share of the bar's own total, 0..100. */
  pct: number;
}

/** One request's bar on the trend chart. */
export interface TrendBar {
  key: string;
  seq: number;
  at: number;
  /** The request's estimated window size (sum of its segments). */
  total: number;
  /** 0..1 of the chart's scale — the drawn height. */
  height: number;
  /** The stack, bottom-up in category order; zero categories are dropped. */
  segments: TrendSegment[];
  /** Provider-reported prompt tokens, when the run reported usage. */
  prompt?: number;
  /** Provider-reported tokens served from cache. */
  cached?: number;
  /** Provider-reported completion tokens. */
  output?: number;
}

/** The trend chart: every request's bar, the shared scale, and the axis ticks. */
export interface TrendChart {
  /** Oldest first — a trend reads left to right; the pane anchors its scroll at the newest end. */
  bars: TrendBar[];
  /** The value the top tick and every height are measured against. */
  scale: number;
  /** Axis labels top→bottom (1 / ¾ / ½ / ¼ / 0 of the scale). */
  ticks: { frac: number; label: string }[];
}

/**
 * The trend chart's bars.
 *
 * Heights share ONE scale so bars are comparable — the TALLEST request, in
 * dsh's own reading (`maxTotal`). Never the model window: a session using 22K of
 * a 1.05M window would draw every bar as 2% of the axis — flat on the floor,
 * the chart saying nothing. The stack's segments are shares of each bar's OWN
 * total, because a request's composition is a fact about that request, not
 * about the chart.
 *
 * But a stack adds to the bar's height, so the segments' heights are shares of
 * the SCALE while their reported percentages are shares of the bar — the same
 * split the composition card makes, for the same reason.
 * @param points - the fold's requests, in log order.
 * @param max - scale override for the 自适应 switch: the peak of the columns
 * currently in view (`trend-geometry.ts`'s `visibleMax`), so a spike scrolled
 * out of reach cannot flatten the ones on screen. Absent (or 0) scales to the
 * whole retained log — the reference's `maxTotal`.
 * @returns the bars (oldest first), the scale and the axis ticks.
 */
export function trendChart(points: readonly ContextPoint[], max?: number): TrendChart {
  const tallest = points.reduce((top, point) => Math.max(top, point.total), 0);
  const scale = max !== undefined && max > 0 ? max : tallest;
  const denominator = scale === 0 ? 1 : scale;
  const bars = points.map((point) => {
    const segments: TrendSegment[] = CATEGORY_ORDER.filter((cat) => (point.cats[cat] ?? 0) > 0).map((cat) => ({
      cat,
      label: categoryLabel(cat),
      color: CATEGORY_COLOR[cat],
      tokens: point.cats[cat] ?? 0,
      pct: percentOf(point.cats[cat] ?? 0, point.total),
    }));
    const bar: TrendBar = {
      key: `p${point.seq}`,
      seq: point.seq,
      at: point.at,
      total: point.total,
      height: Math.min(1, point.total / denominator),
      segments,
      ...(point.prompt !== undefined ? { prompt: point.prompt } : {}),
      ...(point.cached !== undefined ? { cached: point.cached } : {}),
      ...(point.output !== undefined ? { output: point.output } : {}),
    };
    return bar;
  });
  return {
    bars,
    scale,
    ticks: [1, 0.75, 0.5, 0.25, 0].map((frac) => ({ frac, label: formatTokens(Math.round(scale * frac)) })),
  };
}
