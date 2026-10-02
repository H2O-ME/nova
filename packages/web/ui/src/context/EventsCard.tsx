/**
 * The 上下文 pane's events card: why the window changed.
 *
 * Ported from dsh-context `events.tsx` (MIT) in shape, not in enumeration: dsh
 * has six event kinds (compaction / prune / inject / model / mode / genealogy),
 * nova's fold today emits two — compaction and workspace — so the card reads
 * whatever the timeline carries and renders each kind with its own glyph and
 * phrase. Adding a kind is a fold change here, not a UI rebuild.
 *
 * Rows are newest-first (the reader asks "what just happened"), one line each,
 * the same shape the harness uses: glyph + label + position + signed delta +
 * time. The position comes from the event's own `seq` (events carry it); when
 * the host later attaches turn/step stamps the row will surface them without a
 * component change.
 */
import type { ContextEventRecord, ContextTimeline } from '../types.js';
import { relativeStamp } from '../sidebar/relative-time.js';
import css from './ContextView.module.css';

/** The localized phrase for each kind this build may receive. */
const KIND_LABEL: Record<string, string> = {
  compaction: '压缩',
  workspace: '工作区',
  goal: '目标',
};

/** The glyph each kind draws before its label. */
const KIND_GLYPH: Record<string, string> = {
  compaction: '✂',
  workspace: '⇆',
  goal: '◎',
};

export interface EventsCardProps {
  /** The folded timeline; the card reads `events` newest-first. */
  timeline: ContextTimeline;
}

export function EventsCard({ timeline }: EventsCardProps): JSX.Element {
  const events = [...timeline.events].reverse(); // newest-first
  const now = Date.now();
  return (
    <section className={css.card} data-context-events="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>事件</h3>
        <span className={css.trailing}>{timeline.events.length} 条</span>
      </header>
      {events.length === 0 ? (
        <p className={css.empty}>还没有改变窗口的事件。</p>
      ) : (
        <ul className={css.eventList}>
          {events.map((event) => (
            <EventRow key={event.seq} event={event} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One event row. */
function EventRow({ event, now }: { event: ContextEventRecord; now: number }): JSX.Element {
  const label = KIND_LABEL[event.kind] ?? event.kind;
  const glyph = KIND_GLYPH[event.kind] ?? '·';
  const freed = event.freed;
  return (
    <li className={css.eventRow} data-event-kind={event.kind}>
      <span className={css.eventGlyph} aria-hidden="true">{glyph}</span>
      <span className={css.eventChip}>{label}</span>
      {event.detail !== undefined && <span className={css.eventDetail}>{event.detail}</span>}
      <span className={css.eventSpacer} />
      {freed !== undefined && freed > 0 && (
        <span className={css.eventDelta} data-tone="freed">−{freed.toLocaleString()} tok</span>
      )}
      <span className={css.eventTime}>{relativeStamp(event.at, now)}</span>
    </li>
  );
}
