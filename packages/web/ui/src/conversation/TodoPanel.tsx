/**
 * The plan panel: the model's current `todo_write` list, on the composer dock.
 *
 * Collapsed by default and absent when there is no plan, because the list is
 * context for the reader rather than the product — an expanded panel over every
 * conversation would push the composer down for a plan that is usually longer
 * than it is useful. Ported from deepseek-harness
 * `ui-conversation/src/client/skeleton/TodoPanel.tsx` (MIT): the same header
 * counts, the same per-status dots, the same collapsed default.
 */
import { useState } from 'react';
import type { TodoItem } from '../types.js';
import { ChevronDownIcon, ChevronUpIcon, ChecklistIcon } from '../icons.js';
import { StateDot } from '../tool/StateDot.js';
import css from './TodoPanel.module.css';

/** The compact status language the dots share with tool rows. */
function dotState(status: TodoItem['status']): 'done' | 'ongoing' | 'idle' {
  switch (status) {
    case 'completed':
      return 'done';
    case 'in_progress':
      return 'ongoing';
    default:
      return 'idle';
  }
}

/** The status a screen reader reads for one row's decorative marker. */
function statusLabel(status: TodoItem['status']): string {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'in_progress':
      return '进行中';
    default:
      return '待处理';
  }
}

/**
 * The header's count summary, `·`-joined. Zero-count segments are omitted as
 * noise; a non-empty list always keeps at least one. En spaces (U+2002) give the
 * separator room, since HTML collapses runs of ASCII spaces.
 * @param todos - the model's current plan.
 * @returns the summary text.
 */
export function progressLabel(todos: readonly TodoItem[]): string {
  const done = todos.filter((item) => item.status === 'completed').length;
  const active = todos.filter((item) => item.status === 'in_progress').length;
  const pending = todos.length - done - active;
  return [
    ...(done > 0 ? [`${String(done)} 已完成`] : []),
    ...(active > 0 ? [`${String(active)} 进行中`] : []),
    ...(pending > 0 ? [`${String(pending)} 待处理`] : []),
  ].join('\u2002·\u2002');
}

/** The panel. Renders nothing without a plan, so the dock closes up. */
export function TodoPanel({ todos, defaultCollapsed = true }: {
  todos: readonly TodoItem[] | null;
  /**
   * Whether the list starts folded. Defaults to folded (dsh's choice): the plan
   * is context for the reader, and an open list over every conversation pushes
   * the composer down for something usually longer than it is useful.
   */
  defaultCollapsed?: boolean;
}): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (todos === null || todos.length === 0) return null;
  return (
    <section className={css.root} aria-label="任务">
      <div className={css.body}>
        <button
          type="button"
          className={css.header}
          aria-expanded={!collapsed}
          onClick={() => { setCollapsed((value) => !value); }}
        >
          <span className={css.lead} aria-hidden><ChecklistIcon /></span>
          <span className={css.title}>任务</span>
          <span className={css.progress}>{progressLabel(todos)}</span>
          <span className={css.chevron} aria-hidden>
            {collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </span>
        </button>
        {!collapsed && (
          <ul className={css.list}>
            {todos.map((item) => (
              /* Keyed by text: `todo_write` replaces the list wholesale, so the
                 text IS the identity a reader tracks across snapshots. */
              <li key={item.content} className={css.item} data-status={item.status}>
                <span className={css.glyph} role="img" aria-label={statusLabel(item.status)}>
                  <StateDot state={dotState(item.status)} />
                </span>
                <span className={css.content}>{item.content}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
