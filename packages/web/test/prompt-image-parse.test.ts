/**
 * The prompt frame's `images` field: what the host will and will not accept.
 *
 * These are the frames a hostile or buggy client could send, and every one of
 * them must be REJECTED rather than sanitized — a reference that survives
 * validation goes into the durable log and is later sent to the model, so a
 * malformed entry is not a cosmetic problem.
 */
import { describe, expect, it } from 'vitest';
import { parseClientFrame } from '../src/client-frame.js';
import { MAX_PROMPT_IMAGES } from '../src/wire-limits.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function frame(images: unknown): string {
  return JSON.stringify({ type: 'prompt', text: 'look at this', images });
}

function ok(raw: string): { images?: readonly { id: string }[] } {
  const parsed = parseClientFrame(raw);
  // The rejection shape carries `ok: false`; acceptance IS the frame, so the
  // discriminator is the presence of the key rather than a boolean to check.
  if ('ok' in parsed) throw new Error(`expected acceptance, got: ${parsed.reason}`);
  if (parsed.type !== 'prompt') throw new Error('expected a prompt frame');
  return parsed;
}

/** Whether the host refused this raw frame. */
function rejected(raw: string): boolean {
  return 'ok' in parseClientFrame(raw);
}

describe('prompt images acceptance', () => {
  it('accepts a well-formed reference', () => {
    const parsed = ok(frame([{ id: DIGEST, mediaType: 'image/png', bytes: 3 }]));
    expect(parsed.images).toEqual([{ id: DIGEST, mediaType: 'image/png', bytes: 3 }]);
  });

  it('accepts a name and omits the field entirely when absent', () => {
    const named = ok(frame([{ id: DIGEST, mediaType: 'image/png', bytes: 3, name: 'a.png' }]));
    expect(named.images?.[0]).toMatchObject({ name: 'a.png' });
    const anonymous = ok(frame([{ id: DIGEST, mediaType: 'image/png', bytes: 3 }]));
    expect(anonymous.images?.[0]).not.toHaveProperty('name');
  });

  it('omits `images` entirely when the field is absent', () => {
    // A text-only prompt must stay shape-identical to what it was before images
    // existed, so nothing downstream has to handle an empty array.
    const parsed = ok(JSON.stringify({ type: 'prompt', text: 'hi' }));
    expect(parsed).not.toHaveProperty('images');
  });

  it('collapses a repeated digest, since the digest IS the identity', () => {
    const parsed = ok(frame([
      { id: DIGEST, mediaType: 'image/png', bytes: 3 },
      { id: DIGEST, mediaType: 'image/png', bytes: 3 },
    ]));
    expect(parsed.images).toHaveLength(1);
  });

  it('preserves the client order of distinct images', () => {
    const other = `sha256:${'b'.repeat(64)}`;
    const parsed = ok(frame([
      { id: other, mediaType: 'image/webp', bytes: 4 },
      { id: DIGEST, mediaType: 'image/png', bytes: 3 },
    ]));
    expect(parsed.images?.map((entry) => entry.id)).toEqual([other, DIGEST]);
  });
});

describe('prompt images rejection', () => {
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ['a non-array', {}],
    ['a string', 'nope'],
    ['a null entry', [null]],
    ['a string entry', ['x']],
    // The id decides which stored object is sent, so a path-shaped or
    // short id must not reach the store.
    ['an id that is not a digest', [{ id: '../../etc/passwd', mediaType: 'image/png', bytes: 3 }]],
    ['an id with uppercase hex', [{ id: `sha256:${'A'.repeat(64)}`, mediaType: 'image/png', bytes: 3 }]],
    ['a short digest', [{ id: 'sha256:abc', mediaType: 'image/png', bytes: 3 }]],
    ['a missing id', [{ mediaType: 'image/png', bytes: 3 }]],
    // A media type outside the four would be served as something the request
    // layer never accepted.
    ['an unsupported media type', [{ id: DIGEST, mediaType: 'image/svg+xml', bytes: 3 }]],
    ['a media type that is not an image', [{ id: DIGEST, mediaType: 'text/plain', bytes: 3 }]],
    ['a missing media type', [{ id: DIGEST, bytes: 3 }]],
    ['zero bytes', [{ id: DIGEST, mediaType: 'image/png', bytes: 0 }]],
    ['negative bytes', [{ id: DIGEST, mediaType: 'image/png', bytes: -1 }]],
    ['fractional bytes', [{ id: DIGEST, mediaType: 'image/png', bytes: 1.5 }]],
    ['a missing byte count', [{ id: DIGEST, mediaType: 'image/png' }]],
    ['a control character in the name', [{ id: DIGEST, mediaType: 'image/png', bytes: 3, name: 'a\u0000b' }]],
    ['an over-long name', [{ id: DIGEST, mediaType: 'image/png', bytes: 3, name: 'x'.repeat(201) }]],
  ];

  for (const [label, images] of cases) {
    it(`rejects ${label}`, () => {
      expect(rejected(frame(images))).toBe(true);
    });
  }

  it('rejects more images than the per-prompt bound', () => {
    // Each entry is bounded, but an unbounded COUNT would still let one frame
    // queue an arbitrary payload.
    const many = Array.from({ length: MAX_PROMPT_IMAGES + 1 }, (_, i) => ({
      id: `sha256:${i.toString(16).padStart(64, '0')}`,
      mediaType: 'image/png',
      bytes: 3,
    }));
    expect(rejected(frame(many))).toBe(true);
    expect(rejected(frame(many.slice(0, MAX_PROMPT_IMAGES)))).toBe(false);
  });
});
