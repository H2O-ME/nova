/**
 * The trend chart's detail strip: the ACTIVE bar (hovered, pinned, or the
 * newest one) read out — when it went out, what it cost, what the provider
 * reported, and what it was made of.
 *
 * Split from `TrendCard.tsx` because it answers the per-request question while
 * the card answers the over-session one (scale, axes, bars, picking). The
 * strip is the only home of a request's usage figures: the hover bubble carries
 * identity and total only, so one fact is not read in three places.
 */
import type { TrendBar } from './trend-model.js';
import { cacheHitText, formatClock, formatExactTokens } from '../format.js';
import css from './ContextView.module.css';

export function TrendDetail({ bar }: { bar: TrendBar }): JSX.Element {
  const hit = bar.prompt !== undefined && bar.cached !== undefined ? cacheHitText(bar.cached, bar.prompt) : undefined;
  return (
    <div className={css.detail}>
      <div className={css.detailHead}>
        <span className={css.detailWhen}>
          {formatClock(bar.at)} · 约 {formatExactTokens(bar.total)} tokens
        </span>
        {bar.prompt !== undefined && <span>输入 {formatExactTokens(bar.prompt)}</span>}
        {bar.output !== undefined && <span>输出 {formatExactTokens(bar.output)}</span>}
        {hit !== undefined && <span>缓存命中 {hit}%</span>}
      </div>
      <ul className={css.miniLegend}>
        {bar.segments.map((segment) => (
          <li key={segment.cat} className={css.miniItem}>
            <span className={css.legendSwatch} style={{ background: segment.color }} aria-hidden="true" />
            <span className={css.legendLabel}>{segment.label}</span>
            <span className={css.legendValue}>{formatExactTokens(segment.tokens)}</span>
            <span className={css.legendPct}>{segment.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
