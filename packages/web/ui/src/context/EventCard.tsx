/**
 * The Context pane's event log: every compaction and switch that changed the
 * window, newest first, filtered by kind.
 *
 * The kind chips carry their tallies (the fold counted them), so the row of
 * chips is also the answer to "what has happened here" — and a kind with no
 * events still shows its zero rather than disappearing, because a filter row
 * that changes shape as events arrive is a filter row the reader must re-read.
 */
import { useState } from 'react';
import type { ContextEventRecord, ContextTimeline } from '../types.js';
import { formatClock } from '../format.js';
import { cx } from '../composer/cx.js';
import { EVENT_META, eventChips, eventRow } from './activity-model.js';
import css from './ContextView.module.css';

/** One tint per kind (the pill and its glyph), read through the sheet's own binding. */
const TONE: Record<ContextEventRecord['kind'], string | undefined> = {
  compaction: css.toneCompaction,
  workspace: css.toneWorkspace,
  goal: css.toneGoal,
};

export function EventsCard({ events }: { events: ContextTimeline['events'] }): JSX.Element {
  const [kind, setKind] = useState<'all' | ContextEventRecord['kind']>('all');
  const chips = eventChips(events);
  const rows = (kind === 'all' ? events : events.filter((event) => event.kind === kind)).slice().reverse();
  return (
    <section className={css.card} data-context-events="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>上下文事件</h3>
        <div className={css.chipRow}>
          <button
            type="button"
            className={kind === 'all' ? `${css.chip} ${css.chipOn}` : css.chip}
            onClick={() => { setKind('all'); }}
          >
            全部
            <span className={css.chipN}>{events.length}</span>
          </button>
          {chips.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              className={kind === chip.kind ? `${css.chip} ${css.chipOn}` : css.chip}
              onClick={() => { setKind(kind === chip.kind ? 'all' : chip.kind); }}
            >
              <span className={cx(css.chipGlyph, TONE[chip.kind])} aria-hidden="true">{chip.glyph}</span>
              {chip.label}
              <span className={css.chipN}>{chip.count}</span>
            </button>
          ))}
        </div>
      </header>
      {rows.length === 0 ? (
        <p className={css.empty}>还没有发生过压缩或切换。</p>
      ) : (
        <ul className={css.eventList}>
          {rows.map((record) => {
            const line = eventRow(record);
            return (
              <li key={`${record.kind}-${record.seq}`} className={css.eventRow} data-event-kind={record.kind}>
                <span className={cx(css.eventGlyph, TONE[record.kind])} aria-hidden="true">
                  {EVENT_META[record.kind].glyph}
                </span>
                <span className={cx(css.eventPill, TONE[record.kind])}>{line.label}</span>
                <span className={css.eventDetail} title={line.detail}>{line.detail}</span>
                <span className={css.eventTime}>{formatClock(record.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
