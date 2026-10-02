/**
 * The 上下文 pane's DNA card: each request's composition as a stacked bar of
 * categories (the dsh-context "DNA" mode). The Trend card plots the same
 * requests on a shared axis scaled by the tallest bar; DNA reads each one's
 * composition as a SHARE — the longest category dominates the row, so a reader
 * compares requests by their makeup rather than their absolute size.
 *
 * Same data source as the Trend card (the live `ContextPoint.cats`), so DNA is
 * a READ of points already in the timeline — no host fetch. The card HIDES
 * itself when there are no points.
 *
 * Clicking a row fetches the window snapshot (the per-request read the host's
 * `/api/context-window` route serves) and shows the category breakdown as a
 * row of bars under the picked request. That snapshot also backed the pane's
 * Browser card (each request's ELEMENTS, by name); Browser and the pane's
 * activity heatmap were removed by the operator (2026-10-01), so DNA is the
 * surviving reader of the same read.
 */
import { useState } from 'react';
import type { ContextBreakdown, ContextCategory, ContextPoint, ContextWindowSnapshot } from '../types.js';
import { formatExactTokens } from '../format.js';
import { fetchContextWindow } from './window-fetch.js';
import css from './ContextView.module.css';

export interface DnaCardProps {
  /** The current session's points — one row each. */
  points: readonly ContextPoint[];
  /** Absolute path of the open session log; absent when the host did not wire it. */
  sessionFile?: string;
}

/** Categories drawn left-to-right in the stacked bar — same order the composition card uses. */
const DNA_ORDER: readonly ContextCategory[] = ['system', 'tools', 'injected', 'user', 'assistant', 'tool'];

/** Localized one-letter glyph for each category. */
const DNA_GLYPH: Record<ContextCategory, string> = {
  system: '系',
  tools: '工',
  injected: '注',
  user: '用',
  assistant: '答',
  tool: '果',
};

export function DnaCard({ points, sessionFile }: DnaCardProps): JSX.Element {
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<ContextWindowSnapshot | undefined>(undefined);

  if (points.length === 0) return <></>;

  async function toggle(point: ContextPoint): Promise<void> {
    if (sessionFile === undefined) {
      // No host wire: still allow the inline composition strip to expand — it
      // reads only the point's own `cats`, no fetch needed.
      setOpenSeq(openSeq === point.seq ? null : point.seq);
      setSnapshot(undefined);
      return;
    }
    if (openSeq === point.seq) {
      setOpenSeq(null);
      setSnapshot(undefined);
      return;
    }
    setOpenSeq(point.seq);
    setSnapshot(undefined);
    const snap = await fetchContextWindow(sessionFile, point.seq);
    setSnapshot(snap);
  }

  return (
    <section className={css.card} data-context-dna="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>请求 DNA</h3>
        <span className={css.trailing}>{points.length} 次</span>
      </header>
      <ul className={css.dnaList}>
        {points.map((point, index) => {
          const isOpen = openSeq === point.seq;
          return (
            <li key={point.seq} className={css.dnaRow}>
              <button
                type="button"
                className={css.dnaButton}
                aria-expanded={isOpen}
                onClick={() => { void toggle(point); }}
              >
                <span className={css.dnaIndex}>第 {index + 1} 次</span>
                <DnaStrip cats={point.cats} total={point.total} />
              </button>
              {isOpen && snapshot !== undefined && <DnaBreakdown snapshot={snapshot} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A stacked bar showing each category's share of `total`. */
function DnaStrip({ cats, total }: { cats: ContextBreakdown; total: number }): JSX.Element {
  if (total <= 0) return <span className={css.dnaStrip} data-empty="true" />;
  return (
    <span className={css.dnaStrip}>
      {DNA_ORDER.map((cat) => {
        const value = cats[cat] ?? 0;
        if (value <= 0) return null;
        const pct = (value / total) * 100;
        return (
          <span
            key={cat}
            className={css.dnaSegment}
            data-cat={cat}
            style={{ width: `${pct}%` }}
            title={`${cat}: ${formatExactTokens(value)} (${pct.toFixed(0)}%)`}
          />
        );
      })}
    </span>
  );
}

/** The expanded breakdown under a picked request — category rows with absolute counts. */
function DnaBreakdown({ snapshot }: { snapshot: ContextWindowSnapshot }): JSX.Element {
  return (
    <ul className={css.dnaBreakdown}>
      {DNA_ORDER.map((cat) => {
        const value = snapshot.cats[cat] ?? 0;
        if (value <= 0) return null;
        const pct = snapshot.total > 0 ? (value / snapshot.total) * 100 : 0;
        return (
          <li key={cat} className={css.dnaBreakdownRow} data-cat={cat}>
            <span className={css.dnaGlyph} aria-hidden="true">{DNA_GLYPH[cat]}</span>
            <span className={css.dnaCat}>{cat}</span>
            <span className={css.dnaBar}>
              <span className={css.dnaBarFill} style={{ width: `${pct}%` }} />
            </span>
            <span className={css.dnaValue}>{formatExactTokens(value)} · {pct.toFixed(0)}%</span>
          </li>
        );
      })}
    </ul>
  );
}
