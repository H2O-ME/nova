/**
 * Serving an image's bytes BACK to the browser: the one GET route.
 *
 * WHY THIS EXISTS: an image is stored content-addressed (`sha256:<hex>`) and the
 * message that carried it keeps only the reference, so a reload — or any other
 * client attaching — has the id but no pixels. Without this the transcript would
 * silently drop every pasted image on replay: the attachment would be gone from a
 * conversation that plainly had one.
 *
 * WHY IT IS SAFE: the id is the digest, so the request cannot name a path. The
 * address is validated by shape first (`sha256:` + 64 lowercase hex), then the
 * object is looked up UNDER the images directory by that name — there is no
 * traversal to defend against because no user-supplied string is ever joined as a
 * path component. The stored bytes are re-hashed on read (`readImage`), so a
 * tampered object is reported rather than served.
 *
 * Caching: the URL IS the content hash, so the response is immutable and can be
 * cached forever — the same rule the Vite asset bundle uses, for the same reason.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readImage, sniffImageMediaType } from '@nova-agent/core';

/** Prefix of the id-addressed image route (`GET /api/image/<sha256:hex>`). */
export const IMAGE_BYTES_PATH = '/api/image/';

/** The only id shape the store ever mints (see `core/image-store.ts`). */
const IMAGE_ID_RE = /^sha256:[a-f0-9]{64}$/;

/**
 * Handle one image-bytes request.
 * @param req - the incoming request.
 * @param res - the response to write.
 * @param url - the parsed request URL.
 * @returns whether this route handled the request.
 */
export async function handleImageBytes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith(IMAGE_BYTES_PATH)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return true;
  }
  // `pathname` is NOT percent-decoded by the URL parser: a browser asking for
  // `sha256:<hex>` sends `sha256%3A<hex>`, so the raw slice never matches the id
  // shape and every real request would 400. Decode it — and because the shape
  // check below is what actually guards the store, decoding first is safe:
  // `%2e%2e` becomes `..` and is then REJECTED by the shape rather than resolved.
  let raw: string;
  try {
    raw = decodeURIComponent(url.pathname.slice(IMAGE_BYTES_PATH.length));
  } catch {
    // Invalid percent-encoding (`/%`, a truncated UTF-8 escape): a 400, never an
    // uncaught throw that would take the request — and the process — down.
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'bad image id' }));
    return true;
  }
  // Shape first: only a digest-shaped id is ever looked up, so the request can
  // never name a file.
  if (!IMAGE_ID_RE.test(raw)) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'bad image id' }));
    return true;
  }
  const bytes = await readImage({ id: raw, bytes: 0, mediaType: 'image/png' });
  if (bytes === undefined) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'no such image' }));
    return true;
  }
  // The media type comes from the BYTES, not from the URL: the store only ever
  // admits a sniffed raster format, so re-sniffing here both recovers the true
  // type and guarantees the response is never served under a type the object is
  // not. `sniffImageMediaType` is core's one sniffer — reused, not restated.
  const mediaType = sniffImageMediaType(bytes) ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': mediaType,
    'content-length': String(bytes.byteLength),
    // The URL is the content hash: these bytes can never change under this id.
    'cache-control': 'public, max-age=31536000, immutable',
    // Never let a browser treat user-supplied bytes as a document in this
    // origin: the four accepted formats are inert, but the header is the
    // guarantee rather than the format list being one.
    'x-content-type-options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
  return true;
}
