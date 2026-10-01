/**
 * The Context pane's element board: the window's units, one card per category —
 * the open box behind the composition bar. Nothing here re-prices anything: the
 * fold's live list and the bar count the same units. A card's header states the
 * category's own answer and collapses its body.
 */
import { useState } from 'react';
import type { ContextCategory, ContextTimeline } from '../types.js';
import { formatExactTokens } from '../format.js';
import { elementBoard } from './element-model.js';
import css from './ContextView.module.css';

export function ElementCard({ timeline }: { timeline: ContextTimeline }): JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<ContextCategory>>(new Set());
  const board = elementBoard(timeline.live.elements, timeline.live.total);
  const toggle = (cat: ContextCategory): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  return (
    <section className={css.card} data-context-elements="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>窗口元素</h3>
        <span className={css.trailing}>{formatExactTokens(timeline.live.total)} tokens</span>
      </header>
      {board.groups.length === 0 ? (
        <p className={css.empty}>窗口里还没有元素。</p>
      ) : (
        <div className={css.catList}>
          {board.groups.map((group) => {
            const open = !collapsed.has(group.cat);
            return (
              <section key={group.cat} className={css.catCard}>
                <button
                  type="button"
                  className={css.catHead}
                  aria-expanded={open}
                  onClick={() => { toggle(group.cat); }}
                >
                  <span className={css.catChev} data-open={open ? 'true' : 'false'} aria-hidden="true" />
                  <span className={css.catDot} style={{ background: group.color }} aria-hidden="true" />
                  <span className={css.catLabel}>{group.label}</span>
                  <span className={css.catCount}>{group.count} 项</span>
                  <span className={css.catTokens}>{formatExactTokens(group.tokens)}</span>
                  <span className={css.catPct}>{group.pct}%</span>
                </button>
                {open && (
                  <ul className={css.catBody}>
                    {group.rows.map((row) => (
                      <li key={row.key} className={css.elementRow} title={row.preview ?? row.label}>
                        <span className={css.elementLabel}>{row.label}</span>
                        {row.preview !== undefined && <span className={css.elementPreview}>{row.preview}</span>}
                        <span className={css.elementTokens}>{formatExactTokens(row.tokens)}</span>
                        <span className={css.elementPct}>{row.pct}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
