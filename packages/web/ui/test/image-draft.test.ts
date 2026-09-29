/**
 * The image-versus-file routing rule and the upload's error mapping.
 *
 * This is the decision the user asked about, so it is pinned directly: a pasted
 * raster image is uploaded for recognition, while everything else keeps the
 * path-reference answer. The rule is a pure function of the browser's declared
 * MIME type, so it needs no DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  IMAGE_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  isImageMediaType,
  readyImageRefs,
  tooLargeMessage,
  type ImageDraft,
} from '../src/composer/image-draft.js';

describe('isImageMediaType', () => {
  it('selects the four raster formats the request path accepts', () => {
    for (const mediaType of IMAGE_MEDIA_TYPES) {
      expect(isImageMediaType(mediaType)).toBe(true);
    }
    expect(IMAGE_MEDIA_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  });

  it('ignores MIME parameters and case', () => {
    // Browsers attach `;charset=…` and the case is not normalized.
    expect(isImageMediaType('IMAGE/PNG')).toBe(true);
    expect(isImageMediaType('image/png; charset=binary')).toBe(true);
    expect(isImageMediaType(' image/jpeg ')).toBe(true);
  });

  it('refuses "image" formats the request path cannot carry', () => {
    // The decisive cases: these ARE images to a file-type table, and none of
    // them is one of the four formats the model end accepts. Routing them to
    // the upload path would store bytes the request layer must then reject.
    expect(isImageMediaType('image/svg+xml')).toBe(false);
    expect(isImageMediaType('image/bmp')).toBe(false);
    expect(isImageMediaType('image/tiff')).toBe(false);
    expect(isImageMediaType('image/heic')).toBe(false);
    expect(isImageMediaType('image/avif')).toBe(false);
  });

  it('refuses non-images, including an empty type', () => {
    expect(isImageMediaType('text/plain')).toBe(false);
    expect(isImageMediaType('application/pdf')).toBe(false);
    expect(isImageMediaType('video/mp4')).toBe(false);
    // A browser that does not know the type declares nothing; that must take
    // the path route rather than being guessed into the image one.
    expect(isImageMediaType('')).toBe(false);
  });
});

describe('readyImageRefs', () => {
  const ref = { id: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png' as const, bytes: 3 };

  it('takes only ready images, in order', () => {
    const images: ImageDraft[] = [
      { id: '1', bytes: 3, status: 'ready', ref },
      { id: '2', bytes: 3, status: 'uploading' },
      { id: '3', bytes: 3, status: 'failed', error: 'x' },
      { id: '4', bytes: 3, status: 'ready', ref: { ...ref, id: `sha256:${'b'.repeat(64)}` } },
    ];
    const ready = readyImageRefs(images);
    expect(ready.map((entry) => entry.id)).toEqual([ref.id, `sha256:${'b'.repeat(64)}`]);
  });

  it('omits a ready row whose reference is missing', () => {
    // Defensive: the frame parser requires a reference, so sending a ready-but-
    // reference-less row would have the whole prompt rejected by the host.
    expect(readyImageRefs([{ id: '1', bytes: 3, status: 'ready' }])).toEqual([]);
  });

  it('is empty for no images', () => {
    expect(readyImageRefs([])).toEqual([]);
  });
});

describe('tooLargeMessage', () => {
  it('accepts a body at the limit and refuses one byte past it', () => {
    expect(tooLargeMessage(MAX_IMAGE_BYTES)).toBeUndefined();
    expect(tooLargeMessage(MAX_IMAGE_BYTES + 1)).toContain('8MB');
  });
});
