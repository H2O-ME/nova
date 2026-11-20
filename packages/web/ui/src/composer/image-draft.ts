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
 * carry script, and it is not one of the four formats the upload accepts.
 * An SVG pasted from the clipboard keeps the text-reference answer.
 *
 * Everything here is a pure function of its input, so the decision table is
 * testable without a DOM; the two side effects (sending the upload frame and
 * asking the bytes back) go through `client/requests.ts`, so this module stays
 * free of any connection handle.
 */
import type { ImageAttachmentRef } from '../../../src/protocol';
import { requestFrame } from '../client/requests.js';

/**
 * Raster media types the upload accepts, matching core's `IMAGE_MEDIA_TYPES`.
 * Kept as a literal list rather than imported from core: the browser bundle
 * must not pull in core's Node-side modules, and this is the one place the
 * client needs to know the vocabulary.
 */
export const IMAGE_MEDIA_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

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
 * needs no round trip. The URL is revoked by the caller when the row goes away.
 * @param file - the local file.
 * @returns an object URL for an `<img>` preview.
 */
export function previewUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * Base64-encode bytes for the `image_upload` frame. Chunked because
 * `String.fromCharCode` spread over a whole multi-megabyte image would blow
 * the argument limit; 32 KiB per call stays far under it.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Upload one image and return the host's durable reference.
 *
 * The bytes ride the frame as base64: the pipe is line-JSON and there is no
 * request body left to put them in. This is the ONE frame kind exempt from the
 * 512 KiB client ceiling (bounded at 16 MiB), and the host re-sniffs the bytes
 * regardless of the `mediaType` hint, so what decides is always the sniffed
 * type.
 * @param file - the image file to store.
 * @returns the reference, or a human-readable failure reason.
 */
export async function uploadImage(file: File): Promise<
  { ok: true; ref: ImageAttachmentRef } | { ok: false; error: string }
> {
  const tooLarge = tooLargeMessage(file.size);
  if (tooLarge !== undefined) return { ok: false, error: tooLarge };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const reply = await requestFrame(
      {
        type: 'image_upload',
        data: bytesToBase64(bytes),
        ...(file.name === '' ? {} : { name: file.name }),
        // 类型为空就不携带：宿主只信自己嗅探出的类型，这个字段只是路由提示。
        ...(file.type === '' ? {} : { mediaType: file.type }),
      },
      'image_uploaded',
    );
    if (reply === undefined) return { ok: false, error: '图片上传失败：无法连接到宿主' };
    if (reply.ok !== true || reply.ref === undefined) {
      return { ok: false, error: uploadErrorText(reply.error) };
    }
    return { ok: true, ref: reply.ref };
  } catch {
    return { ok: false, error: '图片上传失败：无法连接到宿主' };
  }
}

/** Map the host's refusal code to something a user can act on. */
function uploadErrorText(code: string | undefined): string {
  switch (code) {
    case 'too-large':
      return `图片超过 ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB，无法附加`;
    case 'unsupported-type':
      return '该文件不是可识别的图片格式（支持 PNG / JPEG / WebP / GIF）';
    case 'empty':
      return '图片内容为空，无法附加';
    default:
      return '图片上传失败';
  }
}

/**
 * 已回读图片的永久缓存：id 是内容摘要（sha256），字节永不改变，所以一个
 * id 只需要问一次宿主。缓存的是 Promise 本身——同一 id 的并发请求共享一次
 * 往返，而不是各发一帧。
 */
const imageUrlCache = new Map<string, Promise<string | undefined>>();

/**
 * 取一张已存储图片的可渲染 URL（data URL）。
 *
 * 转录里只带引用（id），旧的 `<img src="/api/image/<id>">` 随浏览器入口一起
 * 消失了：字节现在按帧取回。失败不缓存——断线或超时是可恢复的，下一次渲染
 * 该行会重新请求；`ok: false`（死 id）也一样，反正重试的代价只是一帧。
 * @param id - 宿主引用 id（`sha256:<hex>`）。
 * @returns data URL；宿主答不出字节时为 `undefined`。
 */
export function fetchImageBytes(id: string): Promise<string | undefined> {
  const cached = imageUrlCache.get(id);
  if (cached !== undefined) return cached;
  const task = requestFrame({ type: 'image_bytes', id }, 'image_data', {
    match: (reply) => reply.id === id,
  }).then((reply) => {
    if (reply === undefined || reply.ok !== true || reply.data === undefined) {
      imageUrlCache.delete(id);
      return undefined;
    }
    // mediaType 是宿主从字节里嗅出的，不是帧里声明的，直接可作 data URL 的
    // MIME；嗅探失败时的兜底类型与宿主的 `application/octet-stream` 一致。
    return `data:${reply.mediaType ?? 'application/octet-stream'};base64,${reply.data}`;
  });
  imageUrlCache.set(id, task);
  return task;
}
