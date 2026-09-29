/**
 * The image card's rendered shape, via static markup (the UI lane has no DOM).
 *
 * The three states are the contract: a ready image must render its THUMBNAIL —
 * that preview is the only thing letting a user confirm which screenshot they
 * attached — while an uploading one shows a spinner and a failed one shows the
 * reason instead of an empty box.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImageCard } from '../src/composer/ImageCard.js';
import type { ImageDraft } from '../src/composer/image-draft.js';

const REF = { id: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png' as const, bytes: 12 };

function markup(image: ImageDraft): string {
  return renderToStaticMarkup(<ImageCard image={image} onRemove={() => undefined} />);
}

describe('ImageCard', () => {
  it('renders the thumbnail for a ready image', () => {
    const html = markup({
      id: '1',
      name: 'shot.png',
      bytes: 12,
      status: 'ready',
      ref: REF,
      previewUrl: 'blob:http://localhost/preview',
    });
    expect(html).toContain('<img');
    expect(html).toContain('blob:http://localhost/preview');
    // The alt text names the image: a screen reader gets the same fact the
    // thumbnail gives a sighted user.
    expect(html).toContain('alt="shot.png"');
  });

  it('shows a spinner while uploading and no thumbnail', () => {
    const html = markup({ id: '1', bytes: 12, status: 'uploading' });
    expect(html).not.toContain('<img');
    // The status is announced rather than merely drawn.
    expect(html).toContain('role="status"');
    expect(html).toContain('图片上传中');
  });

  it('shows the refusal reason instead of a picture', () => {
    const html = markup({
      id: '1',
      bytes: 12,
      status: 'failed',
      error: '图片超过 8MB，无法附加',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('图片超过 8MB，无法附加');
  });

  it('always offers a labelled remove control', () => {
    const html = markup({ id: '1', name: 'a.png', bytes: 12, status: 'ready', ref: REF });
    expect(html).toContain('aria-label="移除图片 a.png"');
  });

  it('falls back to a generic remove label with no name', () => {
    // A screenshot has no filename, so the label must still be meaningful.
    const html = markup({ id: '1', bytes: 12, status: 'uploading' });
    expect(html).toContain('aria-label="移除图片 图片"');
  });

  it('renders no thumbnail when a ready row has no preview URL', () => {
    // `previewUrl` is absent where `createObjectURL` does not exist; the row
    // must still be valid rather than render a broken image.
    const html = markup({ id: '1', bytes: 12, status: 'ready', ref: REF });
    expect(html).not.toContain('<img');
  });
});
