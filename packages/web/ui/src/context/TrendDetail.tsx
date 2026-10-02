/**
 * The trend chart's detail: the ACTIVE bar's composition (hovered, pinned, or
 * the newest one — the reference's `activeIdx` fallback), one row per category
 * with a mini track bar, the estimate and its share, and — when the reader has
 * hovered or pinned a NON-newest bar — the signed Δ against the previous bar so
 * a scrub through the trend shows what grew and what shrank.
 *
 * The reference also surfaces a provider pill above the rows (输入 / 输出 / 缓存命中);
 * the row form here adds 缓存命中 to the composition because it is the one
 * provider figure the composition alone cannot derive — everything else on the
 * provider pill repeats the bubble's tokens count.
 */
import type { ContextCategory } from '../types.js';
import type { TrendBar } from './trend-model.js';
import { CATEGORY_COLOR, CATEGORY_ORDER, categoryLabel, percentOf } from './context-model.js';
import { formatExactTokens } from '../format.js';
import css from './ContextView.module.css';

export interface TrendDetailProps {
  /** The active bar. */
  bar: TrendBar;
  /** The bar BEFORE the active one, when there is one (null for the oldest). */
  prev?: TrendBar | null;
}

export function TrendDetail({ bar, prev }: TrendDetailProps): JSX.Element {
  const cacheHitPct = bar.prompt !== undefined && bar.cached !== undefined && bar.prompt > 0
    ? Math.round((bar.cached / bar.prompt) * 100)
    : null;
  return (
    <div className={css.detail}>
      <div className={css.detailRows}>
        {CATEGORY_ORDER.map((cat) => {
          const tokens = bar.segments.find((segment) => segment.cat === cat)?.tokens ?? 0;
          const pct = percentOf(tokens, bar.total);
          const delta = prev !== null && prev !== undefined
            ? (tokens - (prev.segments.find((segment) => segment.cat === cat)?.tokens ?? 0))
            : null;
          return (
            <div key={cat} className={css.detailRow}>
              <i style={{ background: CATEGORY_COLOR[cat] }} />
              <span className={css.detailLabel}>{categoryLabel(cat)}</span>
              <span className={css.detailTrack}>
                <span className={css.detailFill} style={{ width: `${String(pct)}%`, background: CATEGORY_COLOR[cat] }} />
              </span>
              <span className={css.detailNum}>≈{formatExactTokens(tokens)}</span>
              <span className={css.detailPct}>{pct}%</span>
              {delta !== null && delta !== 0 && <DeltaPill delta={delta} />}
            </div>
          );
        })}
      </div>
      {cacheHitPct !== null && (
        <p className={css.detailCacheHit}>
          <span className={css.detailCacheLabel}>缓存命中</span>
          <span className={css.detailCacheValue}>{cacheHitPct}%</span>
          <span className={css.detailCacheMeta}>
            （{formatExactTokens(bar.cached ?? 0)} / {formatExactTokens(bar.prompt ?? 0)}）
          </span>
        </p>
      )}
    </div>
  );
}

/** The signed Δ pill that follows a category row (green for grow, red for shrink). */
function DeltaPill({ delta }: { delta: number }): JSX.Element {
  const tone: 'grow' | 'shrink' = delta > 0 ? 'grow' : 'shrink';
  const sign = delta > 0 ? '+' : '−';
  return (
    <span className={css.detailDelta} data-tone={tone}>
      {sign}{formatExactTokens(Math.abs(delta))}
    </span>
  );
}

/** Re-exported for callers that want to compute category deltas directly. */
export function categoryDelta(prev: TrendBar, next: TrendBar, cat: ContextCategory): number {
  const a = prev.segments.find((segment) => segment.cat === cat)?.tokens ?? 0;
  const b = next.segments.find((segment) => segment.cat === cat)?.tokens ?? 0;
  return b - a;
}
