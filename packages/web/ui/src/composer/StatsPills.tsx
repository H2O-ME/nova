/**
 * Session stats under the composer: two icon pills — a gauge pill (turns and
 * steps, plus speed) and a database pill (billed tokens and cache hit), each
 * opening a small dialog with its rows.
 * Ported from deepseek-harness `ui-chat/src/client/chat/StatsPills.tsx` +
 * `StatsPills.module.css` + the `stat-dialog.module.css` skin (c) 2026 DeepSeek
 * — MIT License; the data contract is this surface's (`stats-model.ts`, fed by
 * the kernel's `run_stats` totals).
 *
 * Two differences, both because the reference has more seats than this product:
 * the reference portals its panels and serves per-turn dialogs from the same
 * skin — here the panels are the composer's own absolutely-positioned popovers
 * (the same shape as the context meter's panel, one dialog per pill, opened
 * exclusively), and the mode is one row of the composer's dock stack.
 *
 * `data-composer-stats` is a stable hook, not a style rule (the reference
 * carries the same attribute and no CSS reads it there either): tests select
 * this row by it. The dock's own emptiness is what hides the row — returning
 * null above leaves the dock with no child nodes, so `:empty` matches.
 */
import { useRef, useState } from 'react';
import { DatabaseIcon, GaugeIcon } from './Icons.js';
import { useDismissOutside } from '../shell/anchored-popover.js';
import { useEscapeToClose } from '../shell/use-escape.js';
import { timePill, usagePill, type PillReading } from './stats-model.js';
import type { SessionTotals } from '../../../src/totals';
import css from './StatsPills.module.css';

/** Which pill's dialog is open (one exclusive slot, the reference's rule). */
type OpenPill = 'time' | 'usage' | null;

/** One pill: its reading, and the dialog it opens. */
function Pill({
  reading,
  label,
  icon,
  open,
  onToggle,
  rows,
}: {
  reading: PillReading;
  /** The dialog's heading (which reading this is). */
  label: string;
  icon: JSX.Element;
  open: boolean;
  onToggle: () => void;
  /** The dialog's rows; empty means the pill is a plain reading, not a button. */
  rows: readonly { label: string; value: string }[];
}): JSX.Element {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const body = (
    <>
      {icon}
      <span className={css.label}>{reading.text}</span>
    </>
  );
  if (rows.length === 0) {
    return (
      <span className={css.anchor}>
        <span className={css.pill} title={reading.text}>{body}</span>
      </span>
    );
  }
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}：${reading.text}`}
        title={reading.text}
        onClick={onToggle}
      >
        {body}
      </button>
      {open && (
        <div className={css.panel} role="dialog" aria-label={label} data-session-stats-panel="">
          <div className={css.panelTitle}>
            <span className={css.panelTitleLabel}>{icon}{label}</span>
          </div>
          <div className={css.panelRule} aria-hidden="true" />
          <dl className={css.details}>
            {rows.map((row) => (
              <div key={row.label} className={css.detail}>
                <dt className={css.detailKey}>{row.label}</dt>
                <dd className={css.detailValue}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </span>
  );
}

export interface StatsPillsProps {
  /** The session's cumulative run numbers (the kernel's own sums). */
  totals: SessionTotals;
}

/**
 * Render the session stats row, or nothing while the session has no numbers.
 * @param props - see StatsPillsProps.
 * @returns the pills row.
 */
export function StatsPills({ totals }: StatsPillsProps): JSX.Element | null {
  const [open, setOpen] = useState<OpenPill>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useDismissOutside(open !== null, [containerRef], () => { setOpen(null); });
  useEscapeToClose([() => { setOpen(null); }]);

  const time = timePill(totals);
  const usage = usagePill(totals);
  if (time === undefined && usage === undefined) return null;

  return (
    <div ref={containerRef} className={css.root} data-composer-stats="">
      {time !== undefined && (
        <Pill
          reading={time}
          label="时间与速度"
          icon={<GaugeIcon />}
          open={open === 'time'}
          onToggle={() => { setOpen(open === 'time' ? null : 'time'); }}
          rows={time.rows}
        />
      )}
      {usage !== undefined && (
        <Pill
          reading={usage}
          label="token 用量"
          icon={<DatabaseIcon />}
          open={open === 'usage'}
          onToggle={() => { setOpen(open === 'usage' ? null : 'usage'); }}
          rows={usage.rows}
        />
      )}
    </div>
  );
}