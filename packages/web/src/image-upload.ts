/**
 * Raw-byte image upload over HTTP: the one route that carries an image's bytes.
 *
 * WHY A SEPARATE ROUTE, not a WebSocket frame: the client-frame ceiling is
 * 512 KiB, and a permitted image is up to 8 MiB, which is ~11 MB once base64'd.
 * A pasted image cannot fit the frame channel at all, so the bytes need a route
 * whose whole purpose is bytes. dsh reaches the same conclusion for the same
 * reason (its `file-upload` package registers a raw-byte HTTP route rather than
 * an RPC method).
 *
 * WHY THIS IS NOT THE OLD UPLOAD ROUTE BACK: the removed `POST /api/upload`
 * copied ANY file — including a video the model could never receive — into a
 * growing cache so `read_file` could reach something that already had a path.
 * This route accepts ONLY bytes that are (a) sniffed as a raster image and
 * (b) about to be sent to the model as image content. A file with a path still
 * crosses as `@path` text; nothing about that changed.
 *
 * Both directions are bounded before a byte is buffered: a lying or absent
 * `content-length` must not decide how much memory is spent, so the stream is
 * counted as it arrives and cut off at the limit.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { admitImage, MAX_IMAGE_BYTES } from '@nova-agent/core';
import { MAX_IMAGE_NAME_CHARS } from './wire-limits.js';

/** Where pasted images are POSTed. */
export const IMAGE_UPLOAD_PATH = '/api/image';

/**
 * Read a request body with a hard byte ceiling.
 *
 * `content-length` is checked first as a cheap refusal, then the ACTUAL bytes
 * are counted: a chunked request may omit the header and a hostile one may
 * understate it, so the header can never be the enforcement point.
 * @param req - the incoming request.
 * @param limit - maximum accepted bytes.
 * @returns the body, or a refusal reason.
 */
export async function readBoundedBody(
  req: IncomingMessage,
  limit: number,
): Promise<{ ok: true; body: Uint8Array } | { ok: false; reason: 'too-large' | 'read-failed' }> {
  const declared = Number(req.headers['content-length'] ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: 'too-large' };
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      total += buf.length;
      if (total > limit) {
        // Stop reading and tear the socket down: draining an oversized body
        // would spend exactly the memory this check exists to protect.
        req.destroy();
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(buf);
    }
  } catch {
    return { ok: false, reason: 'read-failed' };
  }
  return { ok: true, body: new Uint8Array(Buffer.concat(chunks)) };
}

/** Write a JSON response with the given status. */
function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

/**
 * Handle one image upload: method → declared type → bounded read → sniff/store.
 *
 * The media type in the request is only a cheap pre-filter. What decides is the
 * SNIFFED type inside `admitImage`, so a mislabeled body cannot be stored as an
 * image it is not.
 * @param req - the incoming request.
 * @param res - the response to write.
 * @param url - the parsed request URL.
 * @returns whether this route handled the request.
 */
export async function handleImageUpload(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== IMAGE_UPLOAD_PATH) return false;
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return true;
  }
  const declared = (req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase();
  if (declared !== undefined && declared !== '' && !declared.startsWith('image/')) {
    json(res, 415, { ok: false, error: 'body must be image bytes' });
    return true;
  }
  const read = await readBoundedBody(req, MAX_IMAGE_BYTES);
  if (!read.ok) {
    const status = read.reason === 'too-large' ? 413 : 400;
    json(res, status, { ok: false, error: read.reason });
    return true;
  }
  const rawName = url.searchParams.get('name');
  // The name is DISPLAY ONLY and never a path: only its leaf is kept, so a
  // crafted `../../x` cannot become a traversal even if some later code were to
  // treat it as one.
  const name = rawName === null || rawName === ''
    ? undefined
    : [...rawName.replace(/\\/g, '/').split('/').pop()!.trim()].slice(0, MAX_IMAGE_NAME_CHARS).join('');

  const admitted = await admitImage(read.body, name);
  if (!admitted.ok) {
    json(res, 400, { ok: false, error: admitted.reason });
    return true;
  }
  json(res, 200, { ok: true, image: admitted.ref });
  return true;
}
