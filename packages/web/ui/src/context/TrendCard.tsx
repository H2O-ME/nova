/**
 * The Context pane's trend: one bar per completed request, oldest first, each
 * stacked by category, on the plugin's own reading — the TALLEST request scales
 * the axis (`maxTotal`), the 自适应 switch rescales it to the columns in view,
 * and the columns keep their fixed 14px width so a sparse log packs at the left
 * and a dense one scrolls.
 *
 * Hover floats a two-row bubble anchored over its column (the reference's
 * `syncTip`: the tip lives outside the scroller, so scrolling keeps it glued
 * instead of inflating the scrollable width); a click pins the bar. The reading
 * under the plot follows the ACTIVE bar — hovered, pinned, or the newest one
 * (the reference's `activeIdx` fallback) — so scrubbing never changes the
 * card's height.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ContextPoint } from '../types.js';
import { formatExactTokens } from '../format.js';
import { TrendColumn } from './TrendColumn.js';
import { TrendDetail } from './TrendDetail.js';
import { trendChart } from './trend-model.js';
import { BAR_PITCH, BAR_WIDTH, PLOT_PAD } from './trend-geometry.js';
import { useVisibleMax } from './use-visible-max.js';
import css from './ContextView.module.css';

/**
 * The pane ships client-only; the SSR lane (the test suite renders it to a
 * string) runs no layout effects and React warns when it meets one. The alias
 * keeps the pre-paint write on the client — the bubble must be positioned
 * BEFORE its first frame, or it flashes at the plot's left edge — with no
 * warning from the string render, where there is no paint to beat.
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function TrendCard({ points, truncated, window }: { points: readonly ContextPoint[]; truncated: boolean; window?: number }): JSX.Element {
  const [adaptive, setAdaptive] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const visMax = useVisibleMax(scroller, points, adaptive);
  // Memoized so the columns keep their identities: a column only re-renders
  // when its own flags flip or the scale moves, never for a hover elsewhere.
  const chart = useMemo(() => trendChart(points, visMax), [points, visMax]);

  // Anchor the scroll at the newest end: a trend reads left to right, so the
  // request the reader cares about is the one that scrolled out of reach first.
  useEffect(() => {
    const el = scroller.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [chart.bars.length]);

  // The reference's active-bar rule: hover, then the pin, then the newest bar.
  const activeIndex = hover ?? picked ?? (chart.bars.length > 0 ? chart.bars.length - 1 : null);
  const active = activeIndex !== null ? chart.bars[activeIndex] : undefined;

  /**
   * Glue the bubble over its column's visible slice (the reference's own
   * `syncTip`): the column's x is analytic from its index, so no layout read is
   * needed, and the tip is clamped to the viewport before it is centred on the
   * column — a wide tip over an edge column never hangs past the card.
   */
  const tipCol = hover !== null ? PLOT_PAD + hover * BAR_PITCH + BAR_WIDTH / 2 : 0;
  const syncTip = useCallback((): void => {
    const el = scroller.current;
    const bubble = tip.current;
    if (el === null || bubble === null) return;
    const half = Math.min(bubble.offsetWidth / 2, el.clientWidth / 2);
    const cx = Math.min(Math.max(tipCol - el.scrollLeft, half), el.clientWidth - half);
    bubble.style.transform = `translate(${Math.round(cx - bubble.offsetWidth / 2)}px, 0)`;
  }, [tipCol]);
  // Runs after EVERY commit: hovering swaps the bubble's content and moves its
  // column, and both change the width the centring depends on.
  useIsoLayoutEffect(syncTip);

  const enter = useCallback((index: number): void => { setHover(index); }, []);
  const leave = useCallback((): void => { setHover(null); }, []);
  const pick = useCallback((index: number): void => { setPicked((current) => (current === index ? null : index)); }, []);

  return (
    <section className={css.card} data-context-trend="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>上下文趋势</h3>
        {/* The reference's 自适应 switch, title-adjacent: the axis is recomputed
            from the columns currently in view and follows the scroll, so a spike
            far outside the window cannot flatten the ones on screen. */}
        <span className={css.scaleToggle} role="group" title="按当前可视范围内的柱子重新缩放高度，滚动时随之变化">
          <button
            type="button"
            aria-pressed={adaptive}
            className={adaptive ? `${css.scaleBtn} ${css.scaleBtnOn}` : css.scaleBtn}
            onClick={() => { setAdaptive((on) => !on); }}
          >
            自适应
          </button>
        </span>
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
            <div className={css.chartWrap}>
              <div className={css.chartScroll} ref={scroller} onScroll={syncTip}>
                <div className={css.chart}>
                  <div className={`${css.grid} ${css.gridTop}`} aria-hidden="true" />
                  <div className={`${css.grid} ${css.gridQ3}`} aria-hidden="true" />
                  <div className={`${css.grid} ${css.gridMid}`} aria-hidden="true" />
                  <div className={`${css.grid} ${css.gridQ1}`} aria-hidden="true" />
                  <div className={`${css.grid} ${css.gridZero}`} aria-hidden="true" />
                  {chart.bars.map((bar, index) => (
                    <TrendColumn
                      key={bar.key}
                      bar={bar}
                      index={index}
                      picked={index === picked}
                      hovered={index === hover}
                      onEnter={enter}
                      onLeave={leave}
                      onPick={pick}
                    />
                  ))}
                </div>
              </div>
              {hover !== null && chart.bars[hover] !== undefined && (
                // Two rows, the reference's split: how to identify this request,
                // then what it cost. The full reading is the strip below.
                <div className={css.chartTip} ref={tip} role="tooltip">
                  <span>{`第 ${String(hover + 1)} 次请求`}</span>
                  <span>约 {formatExactTokens(chart.bars[hover]!.total)} tokens</span>
                </div>
              )}
            </div>
          </div>
          {active !== undefined && (
            <TrendDetail
              bar={active}
              prev={activeIndex !== null && activeIndex > 0 ? chart.bars[activeIndex - 1] : null}
            />
          )}
        </>
      )}
    </section>
  );
}
