/**
 * Message rows of the transcript — port of the harness `ui-chat`'s
 * `MessageItem.tsx` (user bubble), `AssistantMarkdown.tsx` (full-width
 * narration) and `TurnTailNodeView.tsx` (the closing actions row), trimmed to
 * the block vocabulary this surface's reducer emits:
 *
 *  - `UserMessageRow` — right-aligned capsule whose width is a share of the
 *    content axis, with the copy clock before the icons;
 *  - `AssistantMessage` — full-width markdown body, plus the interrupted-turn
 *    marker;
 *  - `AssistantTailRow` — the turn's closing actions (copy after any usage
 *    slot), the row that reveals itself on hover for earlier turns;
 *  - `MetaRow` — the finished run's numbers, formatted only by `format.ts`.
 *
 * Tool rows are NOT here: they are their own card (`src/tool/`), and the
 * harness keeps them apart too.
 */
import { memo } from 'react';
import type { ReactNode } from 'react';
import { MarkdownText } from './markdown/MarkdownText.js';
import type { MarkdownLabels } from './markdown/labels.js';
import { formatClock, runMetaText } from '../format.js';
import { MessageIconActions } from './MessageIconActions.js';
import type { RunStats } from '../types.js';
import assistantCss from './AssistantMessage.module.css';
import tailCss from './AssistantTail.module.css';
import css from './MessageItem.module.css';

export interface UserMessageRowProps {
  /** The projected user text (plain, no markdown). */
  text: string;
  /** Unix epoch ms of the submission; omitted for a transient echo. */
  time?: number | undefined;
  /** Host-authoritative pre-admission projection (still queued). */
  pending?: boolean | undefined;
  /** Local submission echo: renders exactly like its durable replacement. */
  echo?: boolean | undefined;
  /** Fork the session at this message. */
  onBranch?: (() => void) | undefined;
}

export function UserMessageRow({ text, time, pending, echo, onBranch }: UserMessageRowProps): JSX.Element {
  return (
    <div
      className={css.userRow}
      data-pending-steering={pending ? '' : undefined}
      data-submission-echo={echo ? '' : undefined}
    >
      <div className={css.userStack}>
        <div className={css.bubble}>{text}</div>
      </div>
      <MessageIconActions
        text={text}
        time={time}
        clock="start"
        {...(onBranch === undefined ? {} : { onBranch })}
      />
    </div>
  );
}

export interface AssistantMessageProps {
  /** The reply's markdown source (the projection keeps it verbatim). */
  text: string;
  /** The body is still growing. */
  streaming?: boolean | undefined;
  /** A frozen partial of an aborted turn: renders the stopped marker. */
  interrupted?: boolean | undefined;
  /** Fence chrome; pass a reference-stable object (see `MarkdownText`). */
  labels?: MarkdownLabels | undefined;
}

export const AssistantMessage = memo(function AssistantMessage({
  text,
  streaming = false,
  interrupted = false,
  labels,
}: AssistantMessageProps): JSX.Element {
  return (
    <div className={assistantCss.root} data-streaming={streaming ? '' : undefined}>
      <div className={assistantCss.body}>
        <MarkdownText text={text} streaming={streaming} {...(labels === undefined ? {} : { labels })} />
        {interrupted && <span className={assistantCss.stopped}>本轮已中断</span>}
      </div>
    </div>
  );
});

export interface AssistantTailRowProps {
  /** The turn's full assistant text (what copy writes). */
  text: string;
  /**
   * No clock here, unlike the user row: the turn's line (the `MetaRow` under
   * these controls) already opens with the run's own start time, and two clocks
   * on one turn would be two readings of one thing.
   */
  /** The latest turn reveals its actions always; earlier ones on hover. */
  reveal?: 'always' | 'hover' | undefined;
  onBranch?: (() => void) | undefined;
  branchUnavailable?: boolean | undefined;
  /** Surface-owned actions between copy and branch. */
  extraActions?: ReactNode;
  /** The turn-usage trigger, seated after the branch control. */
  usageAction?: ReactNode;
}

export function AssistantTailRow({
  text,
  reveal = 'hover',
  onBranch,
  branchUnavailable,
  extraActions,
  usageAction,
}: AssistantTailRowProps): JSX.Element {
  return (
    <div className={tailCss.root} data-actions-reveal={reveal}>
      <MessageIconActions
        text={text}
        clock="end"
        className={tailCss.actions}
        {...(onBranch === undefined ? {} : { onBranch })}
        {...(branchUnavailable === undefined ? {} : { branchUnavailable })}
        {...(extraActions === undefined ? {} : { extraActions })}
        {...(usageAction === undefined ? {} : { usageAction })}
      />
    </div>
  );
}

/**
 * One finished run's meta line. Numbers come from the kernel's `run_stats`
 * (the surface measures nothing) and their text comes from `format.ts` — the
 * single formatting place, so the clock and the duration ladder read the same
 * here as in every other row.
 */
export function MetaRow({ stats }: { stats: RunStats }): JSX.Element {
  return (
    <div className={css.metaRow}>
      {formatClock(stats.startedAt)} · {runMetaText(stats)}
    </div>
  );
}

export { CompactionItem } from './CompactionItem.js';
export type { CompactionItemProps } from './CompactionItem.js';