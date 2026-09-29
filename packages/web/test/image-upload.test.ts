/**
 * The image upload route: what it stores, and what it refuses.
 *
 * The route is the only place bytes enter the host from the browser, so its
 * bounds are security properties, not conveniences. Each test drives the real
 * handler over a fake request/response pair — no HTTP server — so the assertion
 * is about the handler's own decisions.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleImageUpload, readBoundedBody } from '../src/image-upload.js';
import { pngBytes } from './helpers/png.js';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'nova-upload-'));
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** A minimal `IncomingMessage` for the handler to read. */
function fakeRequest(options: {
  method?: string;
  contentType?: string;
  declaredLength?: number;
  body?: Uint8Array;
}): IncomingMessage {
  const stream = Readable.from(options.body === undefined ? [] : [Buffer.from(options.body)]);
  // Capture the REAL destroy before shadowing it: calling `stream.destroy()`
  // from an own property that shadows it recurses until the stack dies.
  const realDestroy = stream.destroy.bind(stream);
  return Object.assign(stream, {
    method: options.method ?? 'POST',
    headers: {
      ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }),
      ...(options.declaredLength === undefined ? {} : { 'content-length': String(options.declaredLength) }),
    },
    destroy: realDestroy,
  }) as unknown as IncomingMessage;
}

/** A minimal `ServerResponse` that records what was written. */
function fakeResponse(): {
  res: ServerResponse;
  status: () => number;
  json: () => Record<string, unknown>;
  headers: () => Record<string, string>;
} {
  let status = 0;
  let body = '';
  let headers: Record<string, string> = {};
  const res = {
    writeHead: (code: number, extra?: Record<string, string>) => {
      status = code;
      headers = extra ?? {};
      return res;
    },
    end: (chunk?: string) => { body = chunk ?? ''; return res; },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    headers: () => headers,
    // Not every response is JSON (the 405 is plain text), so parse
    // opportunistically and hand back an empty object for anything else.
    json: () => {
      if (body === '' || body.startsWith('method')) return {};
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

/** Drive the handler and collect its outcome. */
async function upload(
  url: string,
  options: Parameters<typeof fakeRequest>[0],
): Promise<{
  handled: boolean;
  status: number;
  json: Record<string, unknown>;
  headers: Record<string, string>;
}> {
  const out = fakeResponse();
  const handled = await handleImageUpload(
    fakeRequest(options),
    out.res,
    new URL(url, 'http://localhost'),
  );
  return { handled, status: out.status(), json: out.json(), headers: out.headers() };
}

describe('handleImageUpload', () => {
  it('declines a path it does not own', async () => {
    // Returning false is what lets the static handler run for every other path.
    const result = await upload('/index.html', { body: pngBytes() });
    expect(result.handled).toBe(false);
  });

  it('accepts a raster image and returns its reference', async () => {
    const bytes = pngBytes();
    const result = await upload('/api/image?name=shot.png', {
      contentType: 'image/png',
      body: bytes,
    });
    expect(result.handled).toBe(true);
    expect(result.status).toBe(200);
    expect(result.json['ok']).toBe(true);
    const image = result.json['image'] as Record<string, unknown>;
    expect(image['mediaType']).toBe('image/png');
    expect(image['bytes']).toBe(bytes.length);
    expect(image['name']).toBe('shot.png');
  });

  it('sniffs the bytes rather than trusting the declared type', async () => {
    // The decisive case: a body that ANNOUNCES itself as an image but is not
    // one must not be stored. Trusting the header would put it in the image
    // store and later send it to the model as image content.
    const result = await upload('/api/image', {
      contentType: 'image/png',
      body: new TextEncoder().encode('definitely not a png'),
    });
    expect(result.status).toBe(400);
    expect(result.json['error']).toBe('unsupported-type');
  });

  it('refuses a body whose declared type is not an image at all', async () => {
    const result = await upload('/api/image', {
      contentType: 'application/pdf',
      body: pngBytes(),
    });
    expect(result.status).toBe(415);
  });

  it('keeps only the leaf of a path-shaped name', async () => {
    // The name is display metadata echoed into a prompt placeholder, so a
    // traversal attempt must not survive as one.
    const result = await upload('/api/image?name=..%2F..%2Fetc%2Fpasswd', {
      contentType: 'image/png',
      body: pngBytes(),
    });
    expect(result.status).toBe(200);
    expect((result.json['image'] as Record<string, unknown>)['name']).toBe('passwd');
  });

  it('refuses a non-POST method and names the allowed one', async () => {
    const result = await upload('/api/image', { method: 'GET' });
    expect(result.handled).toBe(true);
    expect(result.status).toBe(405);
    // The Allow header is the standard way to say which method is wanted.
    expect(result.headers['allow']).toBe('POST');
  });

  it('refuses a declared length beyond the limit without reading it', async () => {
    const result = await upload('/api/image', {
      contentType: 'image/png',
      declaredLength: 9 * 1024 * 1024,
    });
    expect(result.status).toBe(413);
    expect(result.json['error']).toBe('too-large');
  });

  it('refuses empty bytes', async () => {
    const result = await upload('/api/image', { contentType: 'image/png', body: new Uint8Array(0) });
    expect(result.status).toBe(400);
    expect(result.json['error']).toBe('empty');
  });
});

describe('readBoundedBody', () => {
  it('counts the ACTUAL bytes, not the declared length', async () => {
    // A chunked request may omit content-length entirely, and a hostile one may
    // understate it. The header can therefore never be the enforcement point.
    const body = new Uint8Array(100);
    const result = await readBoundedBody(
      fakeRequest({ body, declaredLength: 1 }),
      50,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-large');
  });

  it('reads a body within the limit', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const result = await readBoundedBody(fakeRequest({ body }), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual(body);
  });

  it('accepts a body exactly at the limit', async () => {
    const body = new Uint8Array(10);
    const result = await readBoundedBody(fakeRequest({ body }), 10);
    expect(result.ok).toBe(true);
  });
});
