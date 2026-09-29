/**
 * Copy / branch (/ clock) icon row shared by the user and assistant message
 * chrome — port of the harness `ui-chat`'s `MessageIconActions.tsx`. Copy is
 * live, branch is optional, and the clock sits before the icons on a user row
 * and after them on an assistant tail.
 *
 * Two seams stay with the owner (the harness passes them in too):
 * `extraActions` for surface-owned controls, and `usageAction` for the
 * turn-usage trigger. The harness renders its labels through a Tooltip
 * primitive; this port uses the button's `title`, which needs no portal and
 * keeps the accessible name (`aria-label`) intact.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { writeClipboard } from '../clipboard.js';
import { BranchGlyph, CheckGlyph, CopyGlyph } from './glyphs.js';
import { formatClock } from '../format.js';
import { useCalendarDay } from './use-calendar-day.js';
import css from './MessageIconActions.module.css';

export interface MessageIconActionsProps {
  /** Plain text the copy action writes. */
  text: string;
  /** Unix epoch ms for the clock label; omitted for transient messages. */
  time?: number | undefined;
  /** Clock before icons (user) or after (assistant). */
  clock: 'start' | 'end';
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined;
  /** The message is not a completed transcript tail, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined;
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined;
  /** Slot-rendered actions owned by independent plugins, between copy and branch. */
  extraActions?: ReactNode;
  /** Icon-row turn-usage trigger, seated after the branch control. */
  usageAction?: ReactNode;
}

export function MessageIconActions({
  text,
  time,
  clock,
  onBranch,
  branchUnavailable = false,
  className,
  extraActions,
  usageAction,
}: MessageIconActionsProps): JSX.Element {
  // The clock label adds a date once the message is no longer from today, so
  // the row subscribes to the local day instead of freezing at mount.
  const day = useCalendarDay();
  const reasonId = useId();
  // Same success chrome as CodeBlock: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  const [copied, setCopied] = useState(false);
  const copyPending = useRef(false);
  const copyTimer = useRef<number | null>(null);
  const copyEpoch = useRef(0);
  useEffect(() => () => {
    copyEpoch.current += 1;
    copyPending.current = false;
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);
  const onCopy = useCallback((): void => {
    if (copied || copyPending.current) return;
    const epoch = copyEpoch.current;
    copyPending.current = true;
    void writeClipboard(text).then((ok) => {
      if (epoch !== copyEpoch.current) return;
      copyPending.current = false;
      if (!ok) return;
      setCopied(true);
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null;
        setCopied(false);
      }, 1000);
    });
  }, [copied, text]);

  const clockEl = time === undefined
    ? null
    : <span className={clock === 'start' ? css.timeStart : css.timeEnd}>{formatClock(time, day)}</span>;
  const copyLabel = copied ? '复制成功' : '复制';
  // The clock and the usage trigger share a trailing cluster, but only in the
  // `end` seat: there they are one group with its own gap and margin, because as
  // bare siblings they would take the row's 8px gap and lose the reference's
  // extra 8px lead-in. In the `start` seat the clock leads the row instead, so
  // the usage trigger stands alone — it must still RENDER, though (dsh's tail
  // does exactly this). Computing `endInfo` for the `end` branch only and then
  // rendering that alone dropped `usageAction` entirely whenever a caller chose
  // `clock="start"`: a prop accepted, threaded, and silently discarded.
  const endInfo = clock === 'end'
    ? (usageAction === undefined && clockEl === null
      ? null
      : <span className={css.endInfo}>{usageAction}{clockEl}</span>)
    : usageAction;

  return (
    <div
      className={className === undefined ? css.actions : `${css.actions} ${className}`}
      data-clock={clock}
    >
      {clock === 'start' ? clockEl : null}
      <button type="button" className={css.action} aria-label={copyLabel} title={copyLabel} onClick={onCopy}>
        {copied ? <CheckGlyph /> : <CopyGlyph />}
      </button>
      {extraActions}
      {onBranch !== undefined && (
        <button
          type="button"
          className={css.action}
          aria-label="在新对话中分支"
          title={branchUnavailable ? '仅可从已完成轮次的最后一条消息分支' : '在新对话中分支'}
          aria-disabled={branchUnavailable || undefined}
          aria-describedby={branchUnavailable ? reasonId : undefined}
          data-unavailable={branchUnavailable || undefined}
          onClick={branchUnavailable ? undefined : onBranch}
        >
          <BranchGlyph />
        </button>
      )}
      {onBranch !== undefined && branchUnavailable && (
        <span id={reasonId} className={css.visuallyHidden}>仅可从已完成轮次的最后一条消息分支</span>
      )}
      {endInfo}
    </div>
  );
}