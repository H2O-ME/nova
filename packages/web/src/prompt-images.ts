/**
 * Host-side admission of the image references a prompt frame cites.
 *
 * The frame's ids are UNTRUSTED: `parseClientFrame` proves each one is shaped
 * like a digest, but not that this host ever stored it. Without this step a
 * client could put an arbitrary reference into the durable log and have it fail
 * at request time — after the user's turn was already committed.
 *
 * So every reference is resolved against the store BEFORE the prompt is logged.
 * One that no longer resolves is dropped and reported (`missing`), not silently
 * omitted: the user picked that image deliberately, and discovering later that
 * it never went is worse than being told now.
 */
import { readImage, type ImageAttachmentRef } from '@nova-agent/core';

/** Outcome of checking a prompt's cited images. */
export interface AdmittedPromptImages {
  /** References whose bytes are present and intact, in the client's order. */
  images: readonly ImageAttachmentRef[];
  /** References that did not resolve (dropped). */
  missing: readonly ImageAttachmentRef[];
}

/**
 * Verify each cited image against the store.
 * @param images - the validated references from the frame; absent means none.
 * @returns the admissible subset and the dropped remainder.
 */
export async function admitPromptImages(
  images: readonly ImageAttachmentRef[] | undefined,
): Promise<AdmittedPromptImages> {
  if (images === undefined || images.length === 0) return { images: [], missing: [] };
  const kept: ImageAttachmentRef[] = [];
  const missing: ImageAttachmentRef[] = [];
  for (const ref of images) {
    // `readImage` verifies the digest, so a truncated or replaced object is
    // treated exactly like a missing one.
    if (await readImage(ref) === undefined) missing.push(ref);
    else kept.push(ref);
  }
  return { images: kept, missing };
}
