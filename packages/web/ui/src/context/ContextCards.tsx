/**
 * The Context pane's head cards: the session's shape (stats strip) and the
 * window's composition — what is in it RIGHT NOW.
 *
 * Split from `ContextView.tsx` because that file answers a different question —
 * how the PANE is framed (scroller, column, refresh on mount, the empty state);
 * the trend, element, event and file cards live in their own files for the same
 * reason. Every figure on show comes from `context-model.ts`'s pure functions,
 * so nothing here derives a number of its own.
 */
import { useState } from 'react';
import type { ContextCategory, ContextTimeline } from '../types.js';
import { formatExactTokens } from '../format.js';
import { compositionBar, occupancy, statCells } from './context-model.js';
import css from './ContextView.module.css';

/** The session's shape as four cells: 轮次 / 请求 / 工具调用 / 缓存命中. */
export function StatsStrip({ timeline }: { timeline: ContextTimeline }): JSX.Element {
  return (
    <section className={css.card} data-context-stats="">
      <dl className={css.stats}>
        {statCells(timeline).map((cell) => (
          <div key={cell.key} className={css.stat}>
            <dt className={css.statLabel}>{cell.label}</dt>
            <dd className={css.statValue}>{cell.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The window now: the headline, the bar, and the legend.
 *
 * Hover is SHARED between the bar's segments and the legend's rows (one state,
 * so the two can never highlight different categories), and the bubble's anchor
 * comes from the model's own percentages — the drawn span and the reported span
 * are the same span.
 */
export function CompositionCard({ timeline, window }: { timeline: ContextTimeline; window?: number }): JSX.Element {
  const [hover, setHover] = useState<ContextCategory | null>(null);
  const bar = compositionBar(timeline.live.cats, window);
  const { tokens, ratio } = occupancy(timeline, window);
  const shown = bar.segments.filter((segment) => segment.tokens > 0);
  const active = shown.find((segment) => segment.cat === hover);
  return (
    <section className={css.card} data-context-headline="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>当前上下文</h3>
        {ratio !== undefined && (
          <span className={css.headlinePct}>
            <b>{Math.round(ratio * 100)}%</b> 上下文已用
          </span>
        )}
      </header>
      <div className={css.headline}>
        <b className={css.headlineNumber}>{formatExactTokens(tokens)}</b>
        <span className={css.headlineUnit}>
          {window !== undefined ? ` / ${formatExactTokens(window)} tokens` : ' tokens（估算）'}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className={css.empty}>窗口里还没有内容。</p>
      ) : (
        <>
          <div className={css.barWrap} onMouseLeave={() => { setHover(null); }}>
            <div className={css.bar} role="img" aria-label="上下文组成">
              {shown.map((segment) => (
                <div
                  key={segment.cat}
                  className={hover !== null && hover !== segment.cat ? `${css.slot} ${css.slotDim}` : css.slot}
                  style={{ background: segment.color, flexGrow: segment.tokens }}
                  aria-label={`${segment.label} ${segment.pct}%`}
                  onMouseEnter={() => { setHover(segment.cat); }}
                />
              ))}
              {bar.usedPercent < 100 && <div className={css.free} aria-hidden="true" />}
            </div>
            {active !== undefined && (
              <div
                className={css.barTip}
                // The model's centre is geometric; the CSS clamp keeps the
                // bubble inside the card without the reading knowing the
                // bubble's width.
                style={{ left: `clamp(48px, ${active.center}%, calc(100% - 48px))` }}
                role="tooltip"
              >
                <b>{active.label}</b>
                <span>{formatExactTokens(active.tokens)} · 占已用 {active.pct}%</span>
              </div>
            )}
          </div>
          <ul className={css.legend}>
            {shown.map((segment) => (
              <li
                key={segment.cat}
                className={hover === segment.cat ? `${css.legendItem} ${css.legendItemOn}` : css.legendItem}
                onMouseEnter={() => { setHover(segment.cat); }}
                onMouseLeave={() => { setHover(null); }}
              >
                <span className={css.legendSwatch} style={{ background: segment.color }} aria-hidden="true" />
                <span className={css.legendLabel}>{segment.label}</span>
                <span className={css.legendValue}>{formatExactTokens(segment.tokens)}</span>
                <span className={css.legendPct}>{segment.pct}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
