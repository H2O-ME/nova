/**
 * The five frames that replaced HTTP routes.
 *
 * Before the desktop cut, four things reached the host over `node:http` rather
 * than the frame channel — not because they belonged there, but because the
 * transport could not carry them:
 *
 *  - `POST /api/image` (bytes: 8 MiB does not fit a 512 KiB frame),
 *  - `GET /api/image/<id>` (an `<img src>` URL, which a browser resolves itself),
 *  - `GET /api/dashboard` and `GET /api/context-window` (plain GETs, written
 *    before anyone thought to ask whether a frame would do),
 *  - `<script src="/plugins/<name>/*">` (the plugin's own asset prefix).
 *
 * With the socket gone, all five come back as frames — and the reason they waited
 * is now handled explicitly: `image_upload` is the ONE frame kind exempt from the
 * 512 KiB client ceiling (bounded at 16 MiB instead), the image's bytes come back
 * as base64 the compositor turns into a blob, and a plugin's asset handler — which
 * already spoke in `IncomingMessage`/`ServerResponse` — is answered through a
 * tiny in-memory response object, so a plugin's routing logic did not change.
 *
 * Every handler here follows the same discipline as the rest of the frame family:
 * validate nothing (the wire did), answer with `ok`/`error` rather than throwing,
 * and never let one failure take the pipe down.
 */
import {
  admitImage,
  aggregateSessions,
  readEvents,
  readImage,
  sessionLogPath,
  sessionsRoot,
  sniffImageMediaType,
} from '@nova-agent/core';
import type { ContextInsights } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './connection.js';
import type { RouteRegistry } from '@nova-agent/core';

/** What the media-response family needs from the controller. */
export interface MediaHost {
  /** The corpus root the dashboard folds over (`~/.nova/sessions` in production). */
  sessionsRootDir: string;
  /**
   * The context plugin's read-at-a-past-position seam. A THUNK, not a resolved
   * value: the container mutates in place when the plugin is switched on or off,
   * so a value captured at boot would leave the frame dead for the rest of the
   * process after the operator enables the plugin. Narrowed to the one member
   * this family folds nothing else from — the same seam the live path reads, so
   * the card and the trend cannot disagree.
   */
  contextWindow: () => Pick<ContextInsights, 'windowAt'> | undefined;
  /** The plugin asset registry, when the shell wired one. */
  routes?: RouteRegistry;
}

/** Decode base64 into bytes, or `undefined` when it is not base64 at all. */
function decodeBase64(data: string): Uint8Array | undefined {
  try {
    return new Uint8Array(Buffer.from(data, 'base64'));
  } catch {
    return undefined;
  }
}

/**
 * `image_upload`: sniff, store, answer with the durable reference.
 *
 * The declared `mediaType` is NOT consulted — `admitImage` sniffs the bytes, and
 * accepting a caller's label would let a mislabeled body decide how it is later
 * served. This is the same rule the route it replaces followed, for the same
 * reason.
 * @param client - the connection to answer.
 * @param frame - the validated upload.
 */
export async function handleImageUploadFrame(
  client: WsConnection,
  frame: Extract<ClientFrame, { type: 'image_upload' }>,
): Promise<void> {
  const bytes = decodeBase64(frame.data);
  if (bytes === undefined) {
    client.send(serialize({ type: 'image_uploaded', ok: false, error: 'invalid-base64' }));
    return;
  }
  // The name is DISPLAY ONLY and never a path: only its leaf is kept, so a
  // crafted `../../x` cannot become a traversal even if some later code were to
  // treat it as one. Same rule, same place as the route it replaces.
  const name = frame.name === undefined || frame.name === ''
    ? undefined
    : [...frame.name.replace(/\\/g, '/').split('/').pop()!.trim()].slice(0, 200).join('');
  try {
    const admitted = await admitImage(bytes, name);
    if (!admitted.ok) {
      client.send(serialize({ type: 'image_uploaded', ok: false, error: admitted.reason }));
      return;
    }
    client.send(serialize({ type: 'image_uploaded', ok: true, ref: admitted.ref }));
  } catch {
    client.send(serialize({ type: 'image_uploaded', ok: false, error: 'store-failed' }));
  }
}

/**
 * `image_bytes`: read one stored object back as base64.
 *
 * The media type comes from the BYTES, not from the request: the store only ever
 * admits a sniffed raster format, so re-sniffing both recovers the true type and
 * guarantees the blob is never labelled as something the object is not.
 * @param client - the connection to answer.
 * @param frame - the validated id.
 */
export async function handleImageBytesFrame(
  client: WsConnection,
  frame: Extract<ClientFrame, { type: 'image_bytes' }>,
): Promise<void> {
  const bytes = await readImage({ id: frame.id, bytes: 0, mediaType: 'image/png' });
  if (bytes === undefined) {
    client.send(serialize({ type: 'image_data', ok: false, id: frame.id, error: 'no such image' }));
    return;
  }
  const mediaType = sniffImageMediaType(bytes) ?? 'application/octet-stream';
  client.send(serialize({
    type: 'image_data',
    ok: true,
    id: frame.id,
    data: Buffer.from(bytes).toString('base64'),
    mediaType,
  }));
}

/**
 * `dashboard`: the corpus activity reading, folded on demand.
 *
 * Computed per request rather than cached: the fold is cheap enough for a card
 * refresh and the corpus is bounded by `listSessionFiles`, so a cached snapshot
 * would only be a way to show yesterday's numbers.
 * @param client - the connection to answer.
 * @param host - the corpus root.
 */
export async function handleDashboardFrame(client: WsConnection, host: MediaHost): Promise<void> {
  try {
    const aggregate = await aggregateSessions(host.sessionsRootDir);
    client.send(serialize({ type: 'dashboard', ok: true, aggregate }));
  } catch {
    client.send(serialize({ type: 'dashboard', ok: false, error: 'aggregate failed' }));
  }
}

/**
 * `context_window`: one request's frozen window, from the context plugin.
 *
 * Three separate refusals, because they are three different facts: the path is
 * outside the sessions root, the log cannot be read, or no element entered before
 * `seq`. Only the first two are `ok: false` paths here — the third is answered by
 * the reader returning `undefined` and is ALSO a refusal, because "there was
 * nothing in the window" is not an empty window.
 * @param client - the connection to answer.
 * @param frame - the validated request.
 * @param host - the corpus root and the context seam.
 */
export async function handleContextWindowFrame(
  client: WsConnection,
  frame: Extract<ClientFrame, { type: 'context_window' }>,
  host: MediaHost,
): Promise<void> {
  const reader = host.contextWindow();
  // A well-formed request, but the plugin that defines "what was in the window"
  // is not installed. Its own refusal, not the log's: blaming the log for a
  // missing capability would be a lie.
  if (reader === undefined) {
    client.send(serialize({ type: 'context_window', ok: false, error: 'context insights unavailable' }));
    return;
  }
  let file: string;
  try {
    file = sessionLogPath(frame.session, host.sessionsRootDir);
  } catch {
    client.send(serialize({ type: 'context_window', ok: false, error: 'session path is outside the sessions dir' }));
    return;
  }
  let events: Awaited<ReturnType<typeof readEvents>>['events'];
  try {
    events = (await readEvents(file)).events;
  } catch {
    client.send(serialize({ type: 'context_window', ok: false, error: 'session not found' }));
    return;
  }
  const snapshot = reader.windowAt(events, frame.seq);
  if (snapshot === undefined) {
    client.send(serialize({ type: 'context_window', ok: false, error: 'no window at this seq' }));
    return;
  }
  client.send(serialize({ type: 'context_window', ok: true, snapshot }));
}

/**
 * A `node:http`-shaped response the plugin handler writes into.
 *
 * A plugin's asset route was written against `ServerResponse`, and rewriting
 * every such plugin to a frame API would be the tail wagging the dog — the
 * handler does not care where its bytes go. This object answers the members a
 * static-asset handler actually uses (`writeHead` + `end`) and records the
 * status/headers so the frame can carry them.
 */
interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array[];
  writeHead(status: number, headers?: Record<string, string>): CapturedResponse;
  setHeader(name: string, value: string): void;
  end(chunk?: string | Uint8Array): void;
}

function capturedResponse(): CapturedResponse {
  const response: CapturedResponse = {
    statusCode: 200,
    headers: {},
    body: [],
    writeHead(status: number, headers?: Record<string, string>): CapturedResponse {
      response.statusCode = status;
      if (headers !== undefined) {
        for (const [name, value] of Object.entries(headers)) response.headers[name.toLowerCase()] = value;
      }
      return response;
    },
    setHeader(name: string, value: string): void {
      response.headers[name.toLowerCase()] = value;
    },
    end(chunk?: string | Uint8Array): void {
      if (typeof chunk === 'string') response.body.push(new Uint8Array(Buffer.from(chunk, 'utf8')));
      else if (chunk !== undefined) response.body.push(chunk);
    },
  };
  return response;
}

/**
 * `plugin_asset`: run one plugin's own HTTP handler and return what it wrote.
 *
 * The registry is the SAME one plugins registered their prefixes against — so a
 * plugin's routing logic, its 404s and its own headers are unchanged; only the
 * destination of its bytes is. A request that matches no prefix is `ok: false`
 * with `no route`, which is exactly what a missing asset route meant before.
 * @param client - the connection to answer.
 * @param frame - the validated asset path.
 * @param host - the plugin route registry.
 */
export async function handlePluginAssetFrame(
  client: WsConnection,
  frame: Extract<ClientFrame, { type: 'plugin_asset' }>,
  host: MediaHost,
): Promise<void> {
  const handler = host.routes?.handlerFor?.(frame.path);
  if (handler === undefined) {
    client.send(serialize({ type: 'plugin_asset', ok: false, path: frame.path, error: 'no route' }));
    return;
  }
  const response = capturedResponse();
  // A handler was written against a real request. The pieces it reads are the
  // method and the URL, and both are implied by this frame: a GET of one path.
  const request = {
    method: 'GET',
    url: frame.path,
    headers: {} as Record<string, string | undefined>,
  };
  try {
    await handler(request as never, response as never, new URL(frame.path, 'http://localhost'));
  } catch {
    client.send(serialize({ type: 'plugin_asset', ok: false, path: frame.path, error: 'handler threw' }));
    return;
  }
  if (response.statusCode !== 200 || response.body.length === 0) {
    client.send(serialize({
      type: 'plugin_asset',
      ok: false,
      path: frame.path,
      error: `handler answered ${response.statusCode}`,
    }));
    return;
  }
  const bytes = Buffer.concat(response.body.map((chunk) => Buffer.from(chunk)));
  client.send(serialize({
    type: 'plugin_asset',
    ok: true,
    path: frame.path,
    // Text, not base64: a client bundle or a stylesheet is UTF-8 by definition,
    // and the loader injects it as a blob of exactly this text.
    text: bytes.toString('utf8'),
    ...(response.headers['content-type'] !== undefined ? { contentType: response.headers['content-type'] } : {}),
  }));
}

/** The corpus root the dashboard and context-window frames fold over. */
export function defaultSessionsRootDir(): string {
  return sessionsRoot();
}

/**
 * Route one of the five media frames to its handler.
 *
 * One entry rather than five call sites in `frame-router.ts` because the family
 * is one decision: they exist because the transport could not carry them, and a
 * reader looking for "what replaced the HTTP routes" should find one function.
 * @param client - the connection to answer.
 * @param frame - the validated frame.
 * @param host - the corpus root, the context seam and the plugin registry.
 */
export async function handleMediaFrame(
  client: WsConnection,
  frame: Extract<ClientFrame, { type: 'image_upload' | 'image_bytes' | 'dashboard' | 'context_window' | 'plugin_asset' }>,
  host: MediaHost,
): Promise<void> {
  switch (frame.type) {
    case 'image_upload':
      await handleImageUploadFrame(client, frame);
      return;
    case 'image_bytes':
      await handleImageBytesFrame(client, frame);
      return;
    case 'dashboard':
      await handleDashboardFrame(client, host);
      return;
    case 'context_window':
      await handleContextWindowFrame(client, frame, host);
      return;
    case 'plugin_asset':
      await handlePluginAssetFrame(client, frame, host);
      return;
  }
}
