/**
 * The Context pane's trend: one bar per completed request, oldest first, each
 * stacked by category, sharing one scale — a bar reads "how full the window was
 * at that request" and the stack reads "of what".
 *
 * Hover previews a bar (the bubble floats over the plot with the time, the
 * total and the provider's own figures); a click pins it so the detail strip
 * under the chart stays put. Those figures are the same reading the
 * transcript's usage pill makes (`cacheHitText`), never a second derivation —
 * and the bubble anchors on the hovered bar's own box, so it stays on the bar
 * at any scroll position.
 */
import { useEffect, useRef, useState } from 'react';
import type { ContextPoint } from '../types.js';
import { formatClock, formatExactTokens } from '../format.js';
import { TrendDetail } from './TrendDetail.js';
import { trendChart } from './trend-model.js';
import css from './ContextView.module.css';

export function TrendCard({ points, truncated, window }: { points: readonly ContextPoint[]; truncated: boolean; window?: number }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [tipLeft, setTipLeft] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const chart = trendChart(points, window);

  // Anchor the scroll at the newest end: a trend reads left to right, so the
  // request the reader cares about is the one that scrolled out of reach first.
  useEffect(() => {
    const el = scroller.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [chart.bars.length]);

  const activeIndex = hover ?? picked ?? (chart.bars.length > 0 ? chart.bars.length - 1 : null);
  const active = activeIndex !== null ? chart.bars[activeIndex] : undefined;

  /** Hovering a bar sets the shared index AND the bubble's anchor (the bar's own centre). */
  const enter = (index: number, el: HTMLElement): void => {
    setHover(index);
    const host = wrap.current;
    if (host === null) return;
    const bar = el.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const left = bar.left + bar.width / 2 - hostRect.left;
    setTipLeft(Math.min(Math.max(left, 24), Math.max(24, hostRect.width - 24)));
  };

  return (
    <section className={css.card} data-context-trend="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>上下文趋势</h3>
        <span className={css.trailing}>
          {chart.bars.length} 次请求{window !== undefined ? ` · 窗口 ${formatExactTokens(window)}` : ''}
          {truncated ? ' · 历史已截断' : ''}
        </span>
      </header>
      {chart.bars.length === 0 ? (
        <p className={css.empty}>发起一轮对话后，这里会展示每次模型请求的上下文构成。</p>
      ) : (
        <>
          <div className={css.chartRow}>
            <div className={css.axis} aria-hidden="true">
              <span className={css.axisTop}>{chart.ticks[0]?.label}</span>
              <span className={css.axisQ3}>{chart.ticks[1]?.label}</span>
              <span className={css.axisMid}>{chart.ticks[2]?.label}</span>
              <span className={css.axisQ1}>{chart.ticks[3]?.label}</span>
              <span className={css.axisBot}>{chart.ticks[4]?.label}</span>
            </div>
            <div className={css.chartWrap} ref={wrap}>
              <div className={css.chartScroll} ref={scroller}>
                <div className={css.chart}>
                  <div className={`${css.grid} ${css.gridTop}`} aria-hidden="true" />
                  <div className={`${css.grid} ${css.gridQ3}`} aria-hidden="true" />
                  <div className={`${css.grid} ${css.gridMid}`} aria-hidden="true" />
                  <div className={`${css.grid} ${css.gridQ1}`} aria-hidden="true" />
                  <div className={`${css.grid} ${css.gridZero}`} aria-hidden="true" />
                  {chart.bars.map((bar, index) => (
                    <button
                      key={bar.key}
                      type="button"
                      className={
                        index === picked
                          ? `${css.trendBar} ${css.trendBarPicked}`
                          : index === hover
                            ? `${css.trendBar} ${css.trendBarHover}`
                            : css.trendBar
                      }
                      data-seq={bar.seq}
                      onMouseEnter={(event) => { enter(index, event.currentTarget); }}
                      onMouseLeave={() => { setHover(null); setTipLeft(null); }}
                      onClick={() => { setPicked((current) => (current === index ? null : index)); }}
                      aria-label={`${formatClock(bar.at)} 约 ${formatExactTokens(bar.total)} tokens`}
                    >
                      <div className={css.trendStack} style={{ height: `${Math.max(2, Math.round(bar.height * 100))}%` }}>
                        {bar.segments.map((segment) => (
                          <div
                            key={segment.cat}
                            className={css.seg}
                            style={{ background: segment.color, flexGrow: segment.tokens }}
                          />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              {active !== undefined && tipLeft !== null && (
                // The bubble echoes the bar under the pointer — identity and
                // total only. The full reading (usage, composition) is the
                // detail strip's, so a fact lives in one place, not three.
                <div className={css.chartTip} style={{ left: `${tipLeft}px` }} role="tooltip">
                  <span>
                    {formatClock(active.at)} · 约 {formatExactTokens(active.total)} tokens
                  </span>
                </div>
              )}
            </div>
          </div>
          {active !== undefined && <TrendDetail bar={active} />}
        </>
      )}
    </section>
  );
}
