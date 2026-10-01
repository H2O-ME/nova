/**
 * The 轨迹 view: the session's durable event log as rows. Where the conversation
 * shows what a reader saw, this shows what the kernel recorded — every `message`
 * append, compaction phase, todo snapshot, approval decision, workspace switch
 * and PTC sub-dispatch, in log order.
 *
 * Why it exists here and not as a copy of the reference's trajectory table: the
 * reference's view is backed by a trajectory snapshot service with request
 * headers, per-turn durations and virtual rows. This kernel's equivalent durable
 * artifact is the session log itself (`Session.events`, the append-only JSONL),
 * so the pane reads THAT — no derived metrics, nothing the log does not contain.
 * The reference's toolbar discipline is kept: the pane states how much of the log
 * it holds and offers the one action it has (load more, or re-read).
 */
import { useEffect } from 'react';
import type { WireTraceRow } from '../types.js';
import { traceRowText } from '../trace-view.js';
import { formatClock } from '../format.js';
import css from './TraceView.module.css';

export interface TraceViewProps {
  /** Rows held, oldest first; null until the first read returns. */
  rows: readonly WireTraceRow[] | null;
  /** Rows the log holds in all. */
  total: number;
  /** A read or page is in flight. */
  pending: boolean;
  /** Read the newest page (also the pane's refresh). */
  onRefresh: () => void;
  /** Page back to rows older than what is held. */
  onLoadEarlier: () => void;
}

export function TraceView({
  rows,
  total,
  pending,
  onRefresh,
  onLoadEarlier,
}: TraceViewProps): JSX.Element {
  // Read on mount: opening the view is the request. Re-mounting (switching back
  // to this tab) re-reads, so the pane is never a stale snapshot of an
  // arbitrarily old moment.
  useEffect(() => { onRefresh(); }, [onRefresh]);
  const held = rows?.length ?? 0;
  const hidden = Math.max(0, total - held);
  return (
    <div className={css.root} data-trace-view="">
      <div className={css.column}>
          <div className={css.toolbar}>
            <span className={css.count} data-trace-count="">
              日志共 {total} 条{hidden > 0 ? ` · 未加载 ${hidden} 条` : ''}
            </span>
            <button type="button" className={css.action} disabled={pending} onClick={onRefresh}>
              {pending ? '读取中…' : '刷新'}
            </button>
          </div>
          {hidden > 0 && (
            <button type="button" className={css.more} disabled={pending} onClick={onLoadEarlier}>
              加载更早的 {Math.min(hidden, 30)} 条
            </button>
          )}
          {rows !== null && rows.length === 0 && <div className={css.empty}>日志里还没有事件。</div>}
          {rows?.map((row, index) => {
            const text = traceRowText(row);
            return (
              // Index key: the pane is a read of an append-only log, and two rows
              // can be byte-identical (two identical approval records).
              <div key={index} className={css.row} data-trace-kind={row.kind}>
                <span className={css.time}>{formatClock(row.ts)}</span>
                <span className={css.label}>{text.label}</span>
                <span className={css.detail} title={text.detail}>{text.detail ?? ''}</span>
                <span className={css.trailing}>{text.trailing ?? ''}</span>
              </div>
            );
          })}
        </div>
    </div>
  );
}