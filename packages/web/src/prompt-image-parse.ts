/**
 * Validation of the `images` field on one prompt frame.
 *
 * Split from `client-frame.ts` (which owns the frame's other fields) because
 * this check carries its own vocabulary — digest-shaped ids, raster media
 * types, per-prompt bounds — and is the only place that knows what an image
 * reference is allowed to look like on the wire.
 */
import { hasControlChars, type ImageAttachmentRef } from '@nova-agent/core';
import { MAX_IMAGE_NAME_CHARS, MAX_PROMPT_IMAGES } from './protocol.js';

/**
 * Image reference ids are content digests (`sha256:<64 hex>`). Checked here so
 * a hostile frame cannot name a path-shaped id and reach the store with it.
 */
const IMAGE_ID_RE = /^sha256:[a-f0-9]{64}$/;
/** The media types `admitImage` can produce; a reference claiming another is a lie. */
const IMAGE_MEDIA_RE = /^image\/(png|jpeg|webp|gif)$/;
/**
 * Validate the `images` field of one prompt frame.
 *
 * Absent means "no images". Each entry must look exactly like what the upload
 * route returns — a digest id, a known raster media type, a positive byte count
 * — because the host will look the id up in the store and send the bytes to the
 * model. A malformed entry is rejected rather than skipped: silently dropping
 * one would attach a subset of what the user selected, and the user would have
 * no way to see which image went missing.
 * @param value - the untrusted `images` field.
 * @returns the validated references, or the reason to reject the frame.
 */
export function parsePromptImages(
  value: unknown,
): { images: readonly ImageAttachmentRef[] } | { error: string } {
  if (value === undefined) return { images: [] };
  if (!Array.isArray(value)) return { error: 'prompt.images must be an array' };
  if (value.length > MAX_PROMPT_IMAGES) {
    return { error: `prompt.images exceeds ${MAX_PROMPT_IMAGES} entries` };
  }
  const images: ImageAttachmentRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: 'each prompt.images entry must be an object' };
    }
    const item = entry as Record<string, unknown>;
    const id = item['id'];
    const mediaType = item['mediaType'];
    const bytes = item['bytes'];
    if (typeof id !== 'string' || !IMAGE_ID_RE.test(id)) {
      return { error: 'prompt.images entry id must be a sha256 digest' };
    }
    if (typeof mediaType !== 'string' || !IMAGE_MEDIA_RE.test(mediaType)) {
      return { error: 'prompt.images entry mediaType must be a raster type' };
    }
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
      return { error: 'prompt.images entry bytes must be a positive integer' };
    }
    // The digest IS the identity, so a repeat is the same image. Collapsing it
    // here means the projector never resolves one image twice for one prompt.
    if (seen.has(id)) continue;
    seen.add(id);
    const rawName = item['name'];
    if (rawName !== undefined && (typeof rawName !== 'string' || rawName.length > MAX_IMAGE_NAME_CHARS)) {
      return { error: `prompt.images entry name must be a string of at most ${MAX_IMAGE_NAME_CHARS} chars` };
    }
    if (typeof rawName === 'string' && hasControlChars(rawName)) {
      return { error: 'prompt.images entry name contains control characters' };
    }
    images.push({
      id,
      mediaType: mediaType as ImageAttachmentRef['mediaType'],
      bytes,
      ...(rawName === undefined ? {} : { name: rawName }),
    });
  }
  return { images };
}