/**
 * One column of the trend plot: a 14px button whose stack rises from the
 * baseline, remembered against its own props.
 *
 * Extracted from `TrendCard.tsx` and memoized for the same reason dsh memoizes
 * its `ChartBar`: a long log draws hundreds of columns, and a hover (two flag
 * flips) or any unrelated card state must not rebuild the other columns. The
 * card keeps the identities stable — its `chart` comes from a `useMemo`, so a
 * column only re-renders when its own bar, index or flags change.
 */
import { memo } from 'react';
import type { TrendBar } from './trend-model.js';
import { formatClock, formatExactTokens } from '../format.js';
import { staggerStyle } from './context-model.js';
import css from './ContextView.module.css';

export interface TrendColumnProps {
  bar: TrendBar;
  index: number;
  picked: boolean;
  hovered: boolean;
  /** The pointer entered this column. */
  onEnter: (index: number) => void;
  onLeave: () => void;
  onPick: (index: number) => void;
}

export const TrendColumn = memo(function TrendColumn({ bar, index, picked, hovered, onEnter, onLeave, onPick }: TrendColumnProps): JSX.Element {
  return (
    <button
      type="button"
      className={picked ? `${css.trendBar} ${css.trendBarPicked}` : hovered ? `${css.trendBar} ${css.trendBarHover}` : css.trendBar}
      data-seq={bar.seq}
      onMouseEnter={() => { onEnter(index); }}
      onMouseLeave={onLeave}
      onClick={() => { onPick(index); }}
      aria-label={`${formatClock(bar.at)} 约 ${formatExactTokens(bar.total)} tokens`}
    >
      {/* The stack carries the entrance rise: keyed by the bar's own seq, so
          appended requests grow in without replaying the bars already on
          screen. */}
      <div
        className={css.trendStack}
        style={{ height: `${Math.max(2, Math.round(bar.height * 100))}%`, ...staggerStyle(index) }}
      >
        {bar.segments.map((segment) => (
          <div key={segment.cat} className={css.seg} style={{ background: segment.color, flexGrow: segment.tokens }} />
        ))}
      </div>
    </button>
  );
});
