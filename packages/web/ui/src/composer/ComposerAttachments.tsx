/**
 * The composer's staged references and images, ported from deepseek-harness
 * `ui-attachment/src/client/ComposerAttachments.tsx` (c) 2026 DeepSeek — MIT
 * License: the box that owns the rail's placement inside the card and renders
 * one card per staged item.
 *
 * TWO kinds share one rail, because they are staged by the same gesture and
 * cleared by the same send, but they travel by different routes — and the
 * comment that used to claim otherwise is why this file is worth reading:
 *
 *  - a **file** is a REFERENCE. It has a path, the card shows it, and the send
 *    appends `@path` to the draft. Nothing is transferred and nothing can fail.
 *  - an **image** is CONTENT. It has no path anywhere, so it is uploaded on
 *    paste (`image-draft.ts`), the card shows a THUMBNAIL, and the send carries
 *    its reference on the frame.
 *
 * So the image card carries an in-flight and a failed state while the file card
 * cannot: one of them is a transfer and the other is a name.
 *
 * The reference's `.rail` box is the load-bearing part: `margin-bottom: -6px`
 * cancels most of the card's 12px flex gap so the cards sit closer to the draft
 * than the other rows do. Without it they float a full 12px above the text.
 */
import { AttachmentRail } from './AttachmentRail.js';
import { FileCard } from './FileCard.js';
import { ImageCard } from './ImageCard.js';
import { ATTACHMENT_GROUP, ATTACHMENT_SCROLL_LEFT, ATTACHMENT_SCROLL_RIGHT, fileRemoveLabel } from './composer-text.js';
import css from './InputBar.module.css';
import type { UploadedFile } from './attachments.js';
import type { ImageDraft } from './image-draft.js';

export interface ComposerAttachmentsProps {
  /** The staged references, in draft order. */
  files: readonly UploadedFile[];
  /** The staged images, in paste order. */
  images: readonly ImageDraft[];
  /** Forget one card. Nothing is deleted from disk — nothing was written. */
  onRemove: (id: string) => void;
  /** Forget one staged image (the stored object is content-addressed and shared). */
  onRemoveImage: (id: string) => void;
}

/**
 * Render the staged rail, or nothing while the draft has none (the card's flex
 * gap then spends nothing on the row).
 * @param props - the staged items and their controls.
 * @returns the rail box, or null.
 */
export function ComposerAttachments({
  files,
  images,
  onRemove,
  onRemoveImage,
}: ComposerAttachmentsProps): JSX.Element | null {
  if (files.length === 0 && images.length === 0) return null;
  // One rail, images first: a pasted screenshot is what the last action added,
  // and the rail reveals newly added items at its end, so the order that needs
  // no scrolling to see is images-then-files only if images come last. Keeping
  // images FIRST here means a paste is visible without the rail paging.
  const items: readonly { id: string }[] = [...images, ...files];
  return (
    <div className={css.rail}>
      <AttachmentRail
        items={items}
        labels={{
          group: ATTACHMENT_GROUP,
          scrollLeft: ATTACHMENT_SCROLL_LEFT,
          scrollRight: ATTACHMENT_SCROLL_RIGHT,
        }}
        renderItem={(item) => {
          const image = images.find((entry) => entry.id === item.id);
          if (image !== undefined) {
            return <ImageCard image={image} onRemove={() => { onRemoveImage(image.id); }} />;
          }
          const file = files.find((entry) => entry.id === item.id);
          if (file === undefined) return null;
          return (
            <FileCard
              name={file.name}
              bytes={file.bytes}
              /* Always `ready`: a reference is complete the moment it is named,
                 and nothing was transferred, so there is no in-flight or failed
                 state to report. The path is the fact a reader checks when two
                 folders hold the same file name, so it is the meta line. */
              state="ready"
              labels={{
                label: file.path,
                remove: fileRemoveLabel(file.name),
                uploading: '',
                failed: '',
                retry: '',
              }}
              onRemove={() => { onRemove(file.id); }}
              onRetry={() => undefined}
            />
          );
        }}
      />
    </div>
  );
}
