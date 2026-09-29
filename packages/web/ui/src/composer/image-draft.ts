/**
 * The pasted-image draft: the ONE kind of browser file that becomes bytes on the
 * host rather than an `@path` mention.
 *
 * The distinction is not a preference, it is a fact about where the bytes live:
 *
 *  - A **file** has a path on the host, so `@path` reaches it and the model
 *    reads it with its own tools. Nothing is copied.
 *  - A **pasted image** has no path anywhere — the clipboard hands the browser
 *    bytes and nothing else (`File.path` is an Electron extension). If those
 *    bytes are not uploaded, nothing later can recover them.
 *
 * Only RASTER images take this route. `image/svg+xml` is deliberately excluded
 * even though the file-type tables call it an image: SVG is a document that can
 * carry script, and it is not one of the four formats the request path accepts.
 * An SVG pasted from the clipboard keeps the text-reference answer.
 *
 * Everything here is a pure function of its input, so the decision table is
 * testable without a DOM; the single side effect (the POST) is isolated in
 * `uploadImage`.
 */
import type { ImageAttachmentRef } from '../../../src/protocol';

/**
 * Raster media types the request path accepts, matching core's
 * `IMAGE_MEDIA_TYPES`. Kept as a literal list rather than imported from core:
 * the browser bundle must not pull in core's Node-side modules, and this is the
 * one place the client needs to know the vocabulary.
 */
export const IMAGE_MEDIA_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

/** Where the bytes are POSTed (the host's only byte-carrying route). */
export const IMAGE_UPLOAD_PATH = '/api/image';

/**
 * Where an ALREADY-STORED image's bytes are read back from.
 *
 * The id is the content digest, so this URL names one immutable object: a
 * transcript row can point at it directly, the browser caches it forever, and no
 * session state is needed to resolve it. That is what lets a reload show the
 * attachment a pasted prompt actually had.
 * @param id - the host reference id (`sha256:<hex>`).
 * @returns the URL to fetch those bytes from.
 */
export function imageRefUrl(id: string): string {
  return `${IMAGE_UPLOAD_PATH}/${encodeURIComponent(id)}`;
}

/** Largest image the host will store, mirroring core's `MAX_IMAGE_BYTES`. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Whether a browser-declared MIME selects the image draft path.
 *
 * The declared type is trusted HERE and only here, as a routing hint: the host
 * re-sniffs the bytes and refuses anything that is not really a raster image, so
 * a mislabeled file fails at the door rather than being stored as an image. All
 * other files take the `@path` route.
 * @param mediaType - the browser's `File.type`.
 * @returns whether this file should be uploaded as image content.
 */
export function isImageMediaType(mediaType: string): boolean {
  return IMAGE_MEDIA_TYPES.includes(mediaType.toLowerCase().split(';', 1)[0]!.trim());
}

/** One image staged in the composer, before or after its upload. */
export interface ImageDraft {
  /** Client-side id for keying and removal. */
  id: string;
  /** Leaf name for display; may be absent (a screenshot has no filename). */
  name?: string;
  /** Byte length of the local file, for the pre-upload size check. */
  bytes: number;
  /** `uploading` until the host answers; `ready` once it has a reference. */
  status: 'uploading' | 'ready' | 'failed';
  /** The durable host reference, present only when `ready`. */
  ref?: ImageAttachmentRef;
  /** Why it failed, for the row to show instead of a thumbnail. */
  error?: string;
  /**
   * Object URL for the thumbnail, owned by `attachments.ts` (created with the
   * row, revoked when it goes away). An object URL pins its blob for the life
   * of the document, so leaving them unrevoked would accumulate a session's
   * worth of screenshots in memory.
   */
  previewUrl?: string;
}

/** The stable subset the prompt frame needs — ready images only, in order. */
export function readyImageRefs(images: readonly ImageDraft[]): readonly ImageAttachmentRef[] {
  const refs: ImageAttachmentRef[] = [];
  for (const image of images) {
    if (image.status === 'ready' && image.ref !== undefined) refs.push(image.ref);
  }
  return refs;
}

/** Refusal text for a file that is too large to attach, or `undefined`. */
export function tooLargeMessage(bytes: number): string | undefined {
  if (bytes <= MAX_IMAGE_BYTES) return undefined;
  return `图片超过 ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB，无法附加`;
}

/**
 * Build an image data URL for the composer's own thumbnail.
 *
 * The browser already holds the bytes it is about to upload, so the preview
 * needs no round trip — and the host serves no read-back route, because a
 * second way to fetch stored bytes would widen the surface for nothing. The URL
 * is revoked by the caller when the row goes away.
 * @param file - the local file.
 * @returns an object URL for an `<img>` preview.
 */
export function previewUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * Upload one image and return the host's durable reference.
 *
 * The bytes go in the BODY, not as base64 in a frame: the client-frame ceiling
 * is 512 KiB and a permitted image is up to 8 MiB, so a frame could not carry it
 * at all. The name rides in the query string because it is display metadata, not
 * content.
 * @param file - the image file to store.
 * @returns the reference, or a human-readable failure reason.
 */
export async function uploadImage(file: File): Promise<
  { ok: true; ref: ImageAttachmentRef } | { ok: false; error: string }
> {
  const tooLarge = tooLargeMessage(file.size);
  if (tooLarge !== undefined) return { ok: false, error: tooLarge };
  const query = file.name === '' ? '' : `?name=${encodeURIComponent(file.name)}`;
  try {
    const response = await fetch(`${IMAGE_UPLOAD_PATH}${query}`, {
      method: 'POST',
      headers: { 'content-type': file.type === '' ? 'application/octet-stream' : file.type },
      body: file,
    });
    const payload = (await response.json().catch(() => undefined)) as
      | { ok?: boolean; image?: ImageAttachmentRef; error?: string }
      | undefined;
    if (!response.ok || payload?.ok !== true || payload.image === undefined) {
      return { ok: false, error: uploadErrorText(payload?.error, response.status) };
    }
    return { ok: true, ref: payload.image };
  } catch {
    return { ok: false, error: '图片上传失败：无法连接到宿主' };
  }
}

/** Map the host's refusal code to something a user can act on. */
function uploadErrorText(code: string | undefined, status: number): string {
  switch (code) {
    case 'too-large':
      return `图片超过 ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB，无法附加`;
    case 'unsupported-type':
      return '该文件不是可识别的图片格式（支持 PNG / JPEG / WebP / GIF）';
    case 'empty':
      return '图片内容为空，无法附加';
    default:
      return `图片上传失败（HTTP ${status}）`;
  }
}
