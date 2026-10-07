/**
 * The stats cards' ring: proportional SVG arcs around an HTML centre label.
 * Ported from dsh-context `components/donut.tsx` (Apache-2.0) — the geometry
 * lives in `donut.ts`, so this file is only the drawing.
 *
 * The centre type scales with the ring's size, so the label always fits inside
 * the hole the thin stroke leaves. A ring with nothing painted draws one neutral
 * track rather than a misleading "100% of nothing" pie, and the ring dims only
 * for a hover that lands on a PAINTED arc — a legend row with no slice leaves it
 * at rest.
 */
import type { CSSProperties } from 'react';
import { donutArcs, type DonutSlice } from './donut-model.js';
import css from './ContextView.module.css';

export interface DonutProps {
  slices: readonly DonutSlice[];
  /** The big centre figure. */
  centerTop: string;
  /** The small caption under the centre figure. */
  centerSub: string;
  /** Outer size in px. */
  size: number;
  /** The hovered slice key — the legend row ↔ segment link. */
  hoverKey: string | null;
  onHoverKey: (key: string | null) => void;
}

export function Donut({ slices, centerTop, centerSub, size, hoverKey, onHoverKey }: DonutProps): JSX.Element {
  const arcs = donutArcs(slices);
  const dim = hoverKey !== null && arcs.some((arc) => arc.key === hoverKey);
  return (
    <div
      className={dim ? `${css.donut} ${css.donutDim}` : css.donut}
      style={{ width: size, height: size }}
      onMouseLeave={() => { onHoverKey(null); }}
    >
      <svg viewBox="0 0 42 42" width={size} height={size} aria-hidden="true">
        {arcs.length === 0 ? (
          <circle className={css.donutTrack} cx="21" cy="21" r="15.9155" />
        ) : (
          arcs.map((arc, index) => (
            <circle
              key={arc.key}
              className={hoverKey === arc.key ? `${css.donutSeg} ${css.donutSegOn}` : css.donutSeg}
              cx="21"
              cy="21"
              r="15.9155"
              strokeDasharray={`${arc.len} ${100 - arc.len}`}
              strokeDashoffset={arc.offset}
              // The sweep-in stagger slot (the pane's own `--lc-i` convention) and
              // the paint: the colours are CSS variables, and SVG presentation
              // attributes cannot carry `var()`.
              style={{ '--lc-i': index, stroke: arc.color } as CSSProperties}
              onMouseEnter={() => { onHoverKey(arc.key); }}
            />
          ))
        )}
      </svg>
      <div className={css.donutCenter}>
        <b style={{ fontSize: Math.max(11, Math.round(size * 0.13)) }}>{centerTop}</b>
        <span style={{ fontSize: Math.max(9, Math.round(size * 0.105)) }}>{centerSub}</span>
      </div>
    </div>
  );
}
