/**
 * One pending-file card in the composer's attachment rail, ported from
 * deepseek-harness `ui-attachment/src/FileCard.tsx` + `FileCard.module.css`
 * (c) 2026 DeepSeek — MIT License: a fixed 240×64 card carrying the category
 * glyph, the file's name (14/22 weight 500), and its meta line (12/15: the
 * extension and the size), with a remove control in the top-right corner that
 * appears on hover.
 *
 * Three states, exactly as the reference draws them: uploading swaps the glyph
 * for a spinner and the meta line for the upload word, plus an indeterminate
 * progress rail along the card's foot; a failed upload turns the meta line and
 * the card's own border red and makes the body a retry button; ready shows the
 * extension and the size.
 */
import { FileTypeIcon } from './FileTypeIcon.js';
import { fileMetaText } from './file-type.js';
import { cx } from './cx.js';
import css from './FileCard.module.css';

/**
 * The reference's `IconCloseFillRegular`, drawn at the card's 12px: a 16-unit
 * box with an 1px stroked cross. Local to this card because the shared set's
 * `CloseIcon` is a different drawing (a rounded 12px cross), and the card is
 * measured against the reference's.
 */
function RemoveGlyph(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden="true">
      <path d="M3.5 3.5L12.5 12.5" />
      <path d="M12.5 3.5L3.5 12.5" />
    </svg>
  );
}

/** Upload display state, resolved by the rail's owner. */
export type FileCardState = 'uploading' | 'ready' | 'error';

export interface FileCardLabels {
  /** The card body's accessible name. */
  label: string;
  /** The remove control's label. */
  remove: string;
  /** The meta line while the upload is in flight. */
  uploading: string;
  /** The meta line after a failed upload. */
  failed: string;
  /** The retry control's label (the failed body). */
  retry: string;
}

export interface FileCardProps {
  /** The name the browser knew it by (the card's first line). */
  name: string;
  /** Exact byte count (the meta line's size half). */
  bytes: number;
  state: FileCardState;
  /** Fraction uploaded, when the transport reported it. */
  progress?: number;
  labels: FileCardLabels;
  onRemove: () => void;
  onRetry: () => void;
}

export function FileCard({
  name,
  bytes,
  state,
  progress,
  labels,
  onRemove,
  onRetry,
}: FileCardProps): JSX.Element {
  const retryable = state === 'error';
  const meta = state === 'uploading'
    ? labels.uploading
    : state === 'error'
      ? labels.failed
      : fileMetaText(name, bytes);
  const body = (
    <>
      <span className={css.name}>{name}</span>
      <span className={retryable ? cx(css.meta, css.metaFailed) : css.meta}>{meta}</span>
    </>
  );
  return (
    <div className={retryable ? cx(css.card, css.failed) : css.card} title={name}>
      <span className={css.icon} aria-hidden="true">
        {state === 'uploading' ? <span className={css.spinner} /> : <FileTypeIcon path={name} />}
      </span>
      {/* The failed card's whole body is the retry control: the reference makes
          the retry the largest possible target rather than a separate button
          beside text that already says what happened. */}
      {retryable ? (
        <button type="button" className={cx(css.body, css.retry)} aria-label={labels.retry} onClick={onRetry}>
          {body}
        </button>
      ) : (
        <span className={css.body} aria-label={labels.label}>{body}</span>
      )}
      <button
        type="button"
        className={retryable ? cx(css.remove, css.removeFailed) : css.remove}
        aria-label={labels.remove}
        onClick={onRemove}
      >
        <RemoveGlyph />
      </button>
      {state === 'uploading' && (
        <span className={css.progressTrack} aria-hidden="true">
          <span
            className={css.progressBar}
            // An inline width is what switches the rail from its indeterminate
            // sweep to a real fraction; `style` presence is the sheet's gate.
            style={progress === undefined
              ? undefined
              : { width: `${String(Math.min(1, Math.max(0, progress)) * 100)}%` }}
          />
        </span>
      )}
    </div>
  );
}
