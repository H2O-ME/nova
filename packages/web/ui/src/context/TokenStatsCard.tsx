/**
 * The 上下文 pane's Token 统计 card: the ring, its legend, and the billed total
 * in the middle. Ported from dsh-context `components/statsTokens.tsx` +
 * `sliceList.tsx` (Apache-2.0).
 *
 * The card answers a different question than the composition card below it —
 * that one reads the window NOW, this one reads what the session has BILLED —
 * which is why both exist and why the two never share a denominator. The hover
 * key is shared between the ring and the legend rows, so the two can never
 * highlight different categories.
 */
import { useState } from 'react';
import type { ContextTimeline } from '../types.js';
import type { SessionTotals } from '@nova-agent/core';
import { formatTokens } from '../format.js';
import { Donut } from './Donut.js';
import { tokenStats } from './token-stats.js';
import css from './ContextView.module.css';

/** The ring's outer size, in px (dsh's `statsTokens` value). */
const RING_SIZE = 96;

export interface TokenStatsCardProps {
  /** The fold's reading — the prompt-side ratios come from its live window. */
  timeline: ContextTimeline;
  /** The session totals the composer's usage pill also reads. */
  totals: SessionTotals;
}

export function TokenStatsCard({ timeline, totals }: TokenStatsCardProps): JSX.Element {
  const [hover, setHover] = useState<string | null>(null);
  const reading = tokenStats(timeline, totals);
  return (
    <section className={css.card} data-context-tokens="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>Token 统计</h3>
      </header>
      <div className={css.donutRow}>
        <Donut
          slices={reading.slices}
          size={RING_SIZE}
          centerTop={reading.reported ? formatTokens(reading.total) : '—'}
          centerSub="总用量"
          hoverKey={hover}
          onHoverKey={setHover}
        />
        <div className={css.sliceList} onMouseLeave={() => { setHover(null); }}>
          {reading.rows.map((row) => {
            const classes = [css.sliceRow];
            if (row.dim) classes.push(css.sliceRowDim);
            if (hover === row.key) classes.push(css.sliceRowOn);
            return (
              <div
                key={row.key}
                className={classes.join(' ')}
                onMouseEnter={() => { setHover(row.key); }}
              >
                <div className={css.sliceMain}>
                  <i className={css.sliceDot} style={{ background: row.color }} aria-hidden="true" />
                  <span className={css.sliceLabel}>{row.label}</span>
                  <span className={css.slicePct}>{row.pct}</span>
                </div>
                <div className={css.sliceSub}>{row.count}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
