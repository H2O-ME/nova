/**
 * A pasted image must survive a RELOAD.
 *
 * The transcript carries only a reference (`sha256:<hex>`), because the bytes
 * live in the content-addressed store and 8 MiB never fits a client frame. That
 * split is what makes this worth pinning: the feature can work perfectly in the
 * live session (the composer shows a thumbnail, the model sees the image) while
 * every reload silently drops the attachment — the conversation plainly had an
 * image and the transcript shows a bare prompt.
 *
 * Two halves are asserted here, and neither implies the other:
 *   1. the projection carries the refs, so the UI has something to draw;
 *   2. the byte route serves those refs, so the `<img>` has something to load.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { admitImage, readImage, type UserMessage } from '@nova-agent/core';
import { projectTranscript } from '../src/transcript.js';
import { handleImageBytes, IMAGE_BYTES_PATH } from '../src/image-bytes.js';
import { pngBytes } from './helpers/png.js';

async function withFakeHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-imgbytes-home-'));
  const prevProfile = process.env['USERPROFILE'];
  const prevHome = process.env['HOME'];
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  try {
    return await fn(home);
  } finally {
    if (prevProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = prevProfile;
    if (prevHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prevHome;
  }
}

/** A minimal request/response pair; only the fields the route reads. */
function fakeExchange(method: string): {
  req: { method: string };
  res: { status?: number; headers?: Record<string, string>; body?: unknown; writeHead(s: number, h?: Record<string, string>): void; end(b?: unknown): void };
} {
  const res = {
    status: undefined as number | undefined,
    headers: undefined as Record<string, string> | undefined,
    body: undefined as unknown,
    writeHead(status: number, headers?: Record<string, string>): void {
      res.status = status;
      res.headers = headers;
    },
    end(body?: unknown): void {
      res.body = body;
    },
  };
  return { req: { method }, res };
}

describe('image bytes route', () => {
  it('serves the stored bytes for a reference the transcript carries', async () => {
    await withFakeHome(async () => {
      const png = pngBytes('route');
      const admitted = await admitImage(png, 'shot.png');
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;

      const { req, res } = fakeExchange('GET');
      const handled = await handleImageBytes(
        req as never,
        res as never,
        new URL(`http://localhost${IMAGE_BYTES_PATH}${encodeURIComponent(admitted.ref.id)}`),
      );
      expect(handled).toBe(true);
      expect(res.status).toBe(200);
      // The type is re-derived from the BYTES, and it is the image's real one.
      expect(res.headers?.['content-type']).toBe('image/png');
      expect(res.headers?.['cache-control']).toContain('immutable');
      expect((res.body as Uint8Array).byteLength).toBe(png.byteLength);
    });
  });

  it('serves the SAME bytes that were stored (not a re-encode)', async () => {
    await withFakeHome(async () => {
      const png = pngBytes('same-bytes');
      const admitted = await admitImage(png);
      if (!admitted.ok) throw new Error('admit failed');
      const stored = await readImage(admitted.ref);
      expect(stored).toBeDefined();

      const { req, res } = fakeExchange('GET');
      await handleImageBytes(
        req as never,
        res as never,
        new URL(`http://localhost${IMAGE_BYTES_PATH}${admitted.ref.id}`),
      );
      expect(Buffer.from(res.body as Uint8Array).equals(Buffer.from(stored as Uint8Array))).toBe(true);
    });
  });

  it('refuses a path-shaped id instead of resolving it as a file', async () => {
    await withFakeHome(async () => {
      // Each entry is the RAW path suffix; the route decodes and then shape-checks
      // it, so an encoded traversal must be refused just like a literal one.
      const bad = [
        '..%2fconfig.json',
        '%2e%2e%2fconfig.json',
        'sha256:short',
        'sha256:' + 'A'.repeat(64),
        'sha256%3A' + 'A'.repeat(64),
        'plain.txt',
      ];
      for (const suffix of bad) {
        const { req, res } = fakeExchange('GET');
        const handled = await handleImageBytes(
          req as never,
          res as never,
          // Built the way the server builds it, so the route sees exactly what a
          // real request would give it.
          new URL(`${IMAGE_BYTES_PATH}${suffix}`, 'http://localhost'),
        );
        expect(handled, `suffix ${suffix}`).toBe(true);
        // Never 200: a traversal attempt must not become a file read.
        expect(res.status, `suffix ${suffix}`).toBe(400);
      }
      // A bare `..` segment never reaches this route at all: the URL parser
      // resolves it away (`/api/image/..` and `/api/image/%2e%2e` both become
      // `/api/`), so the prefix check declines. Asserted so the safety property is
      // recorded even though the URL parser, not this route, provides it.
      for (const escape of ['/api/image/..', '/api/image/%2e%2e', '/api/image/../config.json']) {
        const { req, res } = fakeExchange('GET');
        const handled = await handleImageBytes(req as never, res as never, new URL(escape, 'http://localhost'));
        expect(handled, escape).toBe(false);
      }
    });
  });

  it('reports a missing image as 404, not as an empty 200', async () => {
    await withFakeHome(async () => {
      const { req, res } = fakeExchange('GET');
      const id = 'sha256:' + 'a'.repeat(64);
      await handleImageBytes(req as never, res as never, new URL(`http://localhost${IMAGE_BYTES_PATH}${id}`));
      expect(res.status).toBe(404);
    });
  });

  it('does not handle an unrelated path', async () => {
    const { req, res } = fakeExchange('GET');
    const handled = await handleImageBytes(req as never, res as never, new URL('http://localhost/api/other'));
    expect(handled).toBe(false);
    expect(res.status).toBeUndefined();
  });

  it('rejects a non-GET/HEAD method', async () => {
    const { req, res } = fakeExchange('POST');
    const handled = await handleImageBytes(req as never, res as never, new URL('http://localhost/api/image/x'));
    expect(handled).toBe(true);
    expect(res.status).toBe(405);
    expect(res.headers?.['allow']).toBe('GET, HEAD');
  });
});

describe('transcript carries image references', () => {
  it('projects the refs onto the user block so a reload can re-fetch them', async () => {
    await withFakeHome(async () => {
      const png = pngBytes('projected');
      const admitted = await admitImage(png, 'a.png');
      if (!admitted.ok) throw new Error('admit failed');
      const message: UserMessage = {
        id: 'msg_1',
        ts: 1,
        role: 'user',
        content: '看看这张图',
        images: [admitted.ref],
      };
      const blocks = projectTranscript([message], []);
      const user = blocks.find((b) => b.kind === 'user');
      expect(user).toBeDefined();
      // The decisive assertion: the ref survives the projection. Without it the
      // reloaded transcript has a prompt and no picture.
      expect(user?.images?.map((i) => i.id)).toEqual([admitted.ref.id]);
      expect(user?.images?.[0]?.mediaType).toBe('image/png');
    });
  });

  it('omits the field entirely for a prompt with no images', async () => {
    // The no-image path must stay byte-identical to what it was before images
    // existed, so an ordinary prompt does not grow an empty array.
    const blocks = projectTranscript(
      [{ id: 'msg_1', ts: 1, role: 'user', content: 'just text' }],
      [],
    );
    const user = blocks.find((b) => b.kind === 'user');
    expect(user).toBeDefined();
    expect('images' in (user as object)).toBe(false);
  });
});
