/**
 * The queue strip: what the kernel's prompt queue looks like between the
 * transcript and the input card, ported from deepseek-harness
 * `ui-conversation/src/client/queue/QueueDock.tsx` (MIT).
 *
 * Two differences, both by what our wire carries:
 *  - The harness's rows are addressable queue items with edit / remove / steer
 *    actions and attachments; our kernel publishes `queue_update` with the
 *    pending prompt TEXTS (`{ type: 'queue_update'; items: readonly string[] }`)
 *    and has no frame to mutate a queued row, so the strip is read-only: the
 *    count header, the rows, and their single-line previews, no action seats.
 *    The `.actions` / `.editor` / attachments half of the harness sheet is
 *    therefore not ported — nothing could render it.
 *  - A queued prompt arrives as its own text (the harness ships a host-computed
 *    preview), so the row collapses the whitespace itself (`queuePreview`).
 */
import { useEffect, useId, useState } from 'react';
import { ChevronDownOutline14, ChevronUpOutline14, QueueOutline14 } from './Icons.js';
import { queueCountLabel, queueHeaderVisible, queueListVisible, queuePreview } from './composer-text.js';
import css from './QueueDock.module.css';

export function QueueDock({ items }: { items: readonly string[] }): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(true);
  const listId = useId();
  const count = items.length;
  useEffect(() => {
    // The header is the only way back open, so an emptied queue re-arms the
    // collapsed default instead of letting the next arrival inherit an
    // expansion nobody asked for.
    if (count === 0 && !collapsed) setCollapsed(true);
  }, [count, collapsed]);
  if (count === 0) return null;
  const listVisible = queueListVisible(count, collapsed);
  return (
    <div className={css.dock} data-queue-dock="">
      <div className={css.panel}>
        {queueHeaderVisible(count) && (
          <button
            type="button"
            className={css.header}
            aria-controls={listId}
            aria-expanded={!collapsed}
            onClick={() => { setCollapsed((value) => !value) }}
          >
            <span className={css.lead} aria-hidden="true"><QueueOutline14 /></span>
            <span className={css.count}>{queueCountLabel(count)}</span>
            <span className={css.chevron} aria-hidden="true">
              {collapsed ? <ChevronUpOutline14 /> : <ChevronDownOutline14 />}
            </span>
          </button>
        )}
        <ul id={listId} className={css.list} hidden={!listVisible}>
          {listVisible && items.map((text, index) => (
            // Rows have no identity across frames: the kernel's queue is a
            // positional ledger of pending trigger texts.
            <li key={index} className={css.row}>
              {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
              {count === 1 && <span className={css.lead} aria-hidden="true"><QueueOutline14 /></span>}
              <span className={css.preview}>{queuePreview(text)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}