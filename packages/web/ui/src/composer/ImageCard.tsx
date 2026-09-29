/**
 * One staged IMAGE in the composer's rail: a 64px thumbnail, its spinner while
 * the host stores it, or the refusal if it would not take it.
 *
 * The thumbnail is the whole card on purpose. A referenced file's card shows a
 * path because that path is the fact a reader checks; an image's fact is its
 * pixels, and no filename distinguishes two screenshots. So the preview is not
 * decoration — it is the only affordance that lets a user confirm the right
 * image is attached before sending.
 *
 * The URL is drawn from the LOCAL file. The host deliberately serves no
 * read-back route (a second way to fetch stored bytes would widen the surface
 * for no gain), and the browser is holding the very bytes it just uploaded.
 * This component does not own that URL — `attachments.ts` creates and revokes
 * it, so creation and release sit in one place.
 */
import { imageRemoveLabel } from './composer-text.js';
import { cx } from './cx.js';
import type { ImageDraft } from './image-draft.js';
import css from './ImageCard.module.css';

/** The card's cross, drawn to the same 12px as the file card's. */
function RemoveGlyph(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden="true">
      <path d="M3.5 3.5L12.5 12.5" />
      <path d="M12.5 3.5L3.5 12.5" />
    </svg>
  );
}

export interface ImageCardProps {
  image: ImageDraft;
  onRemove: () => void;
}

export function ImageCard({ image, onRemove }: ImageCardProps): JSX.Element {
  const remove = imageRemoveLabel(image.name ?? '图片');
  return (
    <div className={image.status === 'failed' ? cx(css.card, css.failed) : css.card} title={image.name}>
      {image.status === 'ready' && image.previewUrl !== undefined && (
        <img className={css.thumb} src={image.previewUrl} alt={image.name ?? '已附加的图片'} />
      )}
      {image.status === 'uploading' && (
        <span className={css.spinner} role="status" aria-label="图片上传中" />
      )}
      {image.status === 'failed' && (
        <span className={css.error} role="status">{image.error ?? '图片上传失败'}</span>
      )}
      <button type="button" className={css.remove} aria-label={remove} onClick={onRemove}>
        <RemoveGlyph />
      </button>
    </div>
  );
}
