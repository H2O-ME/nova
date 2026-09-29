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
 *
 * Tool rows are NOT here: they are their own card (`src/tool/`), and the
 * harness keeps them apart too. The finished run's numbers ride the turn
 * header and the tail's usage pill (see `chat/TurnHeader.tsx`), not a row here.
 */
import { memo } from 'react';
import type { ReactNode } from 'react';
import { imageRefUrl } from '../composer/image-draft.js';
import { MarkdownText } from './markdown/MarkdownText.js';
import type { MarkdownLabels } from './markdown/labels.js';
import { MessageIconActions } from './MessageIconActions.js';
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
  /**
   * Images this prompt attached, by reference. Fetched from the
   * content-addressed route rather than carried in the frame, so a reload shows
   * the attachment the conversation actually had.
   */
  images?: readonly { id: string; mediaType: string }[] | undefined;
  /** Fork the session at this message. */
  onBranch?: (() => void) | undefined;
}

export function UserMessageRow({ text, time, pending, echo, images, onBranch }: UserMessageRowProps): JSX.Element {
  return (
    <div
      className={css.userRow}
      data-pending-steering={pending ? '' : undefined}
      data-submission-echo={echo ? '' : undefined}
    >
      <div className={css.userStack}>
        {images !== undefined && images.length > 0 && (
          <div className={css.attachmentRow} data-message-attachments>
            {images.map((image) => (
              <img
                key={image.id}
                className={css.attachmentImage}
                src={imageRefUrl(image.id)}
                alt="已附加的图片"
                // Decorative to the model-facing text but meaningful to the
                // reader, so it is a normal image with an alt rather than
                // aria-hidden: a pasted screenshot IS the prompt.
                loading="lazy"
              />
            ))}
          </div>
        )}
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
   * Unix epoch ms of the closing message: the wall-clock stamp after the
   * usage slot (`TurnTailNodeView` passes `closing.time` the same way). The
   * run's *duration* stays on the turn header — this is when the answer
   * landed, not how long it took.
   */
  time?: number | undefined;
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
  time,
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
        {...(time === undefined ? {} : { time })}
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
 * One finished run's meta line was absorbed by the turn header
 * (`chat/TurnHeader.tsx`) and the tail's usage pill (`chat/TurnUsagePill.tsx`):
 * the header carries the duration, the tail the tokens and the clock.
 */

export { CompactionItem } from './CompactionItem.js';
export type { CompactionItemProps } from './CompactionItem.js';