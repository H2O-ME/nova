/**
 * Single-process HTTP + WebSocket server for the WebUI (M11 批2). One Node
 * process: `node:http` serves the built React bundle (static files) and the kernel
 * event stream (WS on `/ws`), both gated by a signed cookie from the launch token.
 * There is no separate API surface — the durable log is the only state and the WS
 * stream is the only channel, so a reconnect is just a new socket that replays
 * `ready` then follows events.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RouteRegistry } from '@nova-agent/core';
import { sessionsRoot } from '@nova-agent/core';
import { parseClientFrame } from './client-frame.js';
import type { FrameRejection } from './reject.js';
import { cookieHeader, cookieValue, verifyCookie, type LaunchAuth } from './auth.js';
import { listenWithPreferredPort } from './listen.js';
import type { WebController } from './controller.js';
import { handleImageUpload } from './image-upload.js';
import { handleImageBytes } from './image-bytes.js';
import { handleDashboard } from './dashboard.js';
import { handleContextWindow, type ContextWindowReader } from './context-window.js';
import { upgrade, type WsConnection } from './ws.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export interface WebServerHandle {
  server: Server;
  port: number;
  /** Full launch URL the user opens (carries the one-time token). */
  url: string;
  close(): Promise<void>;
}

export interface StartWebServerOptions {
  controller: WebController;
  auth: LaunchAuth;
  /** Directory of the built Vite frontend assets. */
  staticDir: string;
  host: string;
  port?: number;
  /**
   * Where the remembered port lives. Defaults to the cache root so the origin
   * survives restarts; tests point it at a temp file.
   */
  portStore?: string;
  /**
   * The plugin asset route registry. When a request's path matches a prefix a
   * plugin registered, the registry's handler runs INSTEAD of static serving
   * (and before it). The auth gate still applies first: a plugin route is a
   * private read, not an unauthenticated public asset. Absent in tests and in
   * any shell that did not wire the seam — the server then serves as usual.
   */
  routes?: RouteRegistry;
  /**
   * The sessions root the dashboard route folds over. Defaults to the host's
   * own `sessionsRoot()` (the ~/.nova/sessions tree). Tests point it at a temp
   * directory so a corpus read never touches real logs.
   */
  sessionsRootDir?: string;
  /**
   * The context plugin's read-at-a-past-position seam, for the Browser/DNA
   * route. A THUNK, not a resolved value: the container mutates in place when a
   * plugin is switched on or off, so a value captured at boot would leave the
   * route dead for the rest of the process after the operator enables the
   * plugin. Absent (tests, or a shell that did not wire the seam) means the
   * route answers "capability unavailable" instead of failing to load.
   */
  contextWindow?: () => ContextWindowReader | undefined;
}

export function startWebServer(opts: StartWebServerOptions): Promise<WebServerHandle> {
  const { controller, auth, staticDir, routes } = opts;
  const sessionsRootDir = opts.sessionsRootDir ?? sessionsRoot();
  const server = createServer((req, res) => {
    // `handleHttp` is async, so a throw inside it would surface as an unhandled
    // rejection — and Node's default mode for those is to end the process. One
    // unauthenticated malformed path (`/%`, whose `decodeURIComponent` throws
    // URIError) would therefore kill the whole server, run and socket alike.
    // The handler answers its own failures; this is the backstop for anything
    // that escapes it, so a bad request can only ever fail that request.
    handleHttp(req, res, {
      controller,
      auth,
      staticDir,
      sessionsRootDir,
      ...(routes !== undefined ? { routes } : {}),
      ...(opts.contextWindow !== undefined ? { contextWindow: opts.contextWindow } : {}),
    }).catch(() => {
      if (!res.headersSent) deny(res, 500, 'internal error');
      else res.end();
    });
  });
  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head, { controller, auth });
  });
  return listenWithPreferredPort(server, opts);
}

interface HttpCtx {
  controller: WebController;
  auth: LaunchAuth;
  staticDir: string;
  sessionsRootDir: string;
  routes?: RouteRegistry;
  contextWindow?: () => ContextWindowReader | undefined;
}

async function handleHttp(req: IncomingMessage, res: ServerResponse, ctx: HttpCtx): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // Launch hop: /?t=<token> verifies the token, sets the cookie, redirects.
  const token = url.searchParams.get('t');
  if (token !== null) {
    const value = cookieValue(ctx.auth, token);
    if (value === undefined) {
      deny(res, 403, 'bad token');
      return;
    }
    res.writeHead(302, { 'Set-Cookie': cookieHeader(value), Location: '/' });
    res.end();
    return;
  }
  // ONE canonical path, resolved once, before anything else reads it. The
  // public-asset exemption and the static join must judge the SAME text, or an
  // encoded separator (`/icons/..%2findex.html` — WHATWG URL also folds a raw
  // `\` into `/`) reads as a brand prefix here and lands on a private file at
  // the join. Dot segments are refused outright: no legitimate client sends
  // one, and resolving them is exactly the step that turned aliases into
  // bypasses. Plugin routes are matched on the same canonical path and are
  // ALWAYS behind the auth gate — only a brand asset that no plugin claims is
  // public.
  const canonical = canonicalPath(url.pathname);
  if (canonical === undefined) {
    deny(res, 400, 'bad path');
    return;
  }
  const relPath = canonical === '/' ? '/index.html' : canonical;
  const routeHandler = ctx.routes?.handlerFor?.(relPath);
  const isPublicAsset =
    routeHandler === undefined &&
    (relPath === '/manifest.webmanifest' || relPath === '/favicon.svg' || relPath.startsWith('/icons/'));
  if (!isPublicAsset && !verifyCookie(ctx.auth, req.headers.cookie)) {
    deny(res, 401, 'unauthorized');
    return;
  }
  // Plugin asset routes: a plugin that ships UI capabilities registers its
  // prefixes via `ctx.must(routes)`; the registry answers here, INSIDE the
  // auth gate (a plugin asset is a private read like everything else that is
  // not a brand asset) and BEFORE image handling and static serving. The
  // registry dispatches in reverse-registration order, so a later plugin can
  // override an earlier prefix — the same replace-by-key semantics the
  // container uses for service providers. A handler that does not match (no
  // registry, or no prefix hit) falls through to the host's own handlers.
  if (routeHandler !== undefined) {
    try {
      await routeHandler(req, res, url);
    } catch {
      if (!res.headersSent) deny(res, 500, 'plugin route error');
      else res.end();
    }
    return;
  }
  // Image upload: the only route that carries image BYTES. It must be handled
  // before static serving, which would otherwise 404 the path. See
  // `image-upload.ts` for why images need a route while files do not: a file
  // has a path and crosses as `@path` text, but a pasted image exists only as
  // clipboard bytes, and 8 MiB does not fit the 512 KiB client-frame channel.
  if (await handleDashboard(req, res, url, ctx.sessionsRootDir)) return;
  if (await handleContextWindow(req, res, url, ctx.sessionsRootDir, ctx.contextWindow?.())) return;
  if (await handleImageUpload(req, res, url)) return;
  // Image bytes BACK to the browser: the transcript carries only the reference,
  // so without this a reload would silently drop every pasted image.
  if (await handleImageBytes(req, res, url)) return;
  // Static file serving. `/` → index.html; everything else resolved under
  // staticDir (traversal refused). Unknown/missing → 404 (SPA single page).
  // `canonicalPath` already refused dot segments, backslashes and control
  // characters, so the join below cannot climb out of `staticDir`; the
  // containment check stays as defense in depth, not as the only gate.
  const abs = path.join(ctx.staticDir, relPath);
  if (!abs.startsWith(ctx.staticDir + path.sep) && abs !== ctx.staticDir) {
    deny(res, 400, 'bad path');
    return;
  }
  try {
    const data = await readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': cachePolicy(relPath),
    });
    res.end(data);
  } catch {
    deny(res, 404, 'not found');
  }
}

/**
 * The one cache policy for the bundle, per path. Vite writes `/assets/<name>-<hash>.<ext>`
 * (content-hashed, so a rebuild changes the URL) and `index.html` (NOT hashed,
 * and the only file that names the current hashes). Answering `index.html` out
 * of a keep-alive browser cache hands the page a script URL the last build
 * deleted — a reload that shows yesterday's UI, or nothing at all — so the
 * document must revalidate while the assets never need to.
 * @param relPath - the request path as served (`/index.html`, `/assets/x.js`).
 * @returns the `cache-control` value for that path.
 */
export function cachePolicy(relPath: string): string {
  return relPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

function deny(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: message }));
}

/**
 * The ONE canonical form of a request path: percent-decoded once, with every
 * escape hatch closed before anything judges it.
 *
 * - Invalid percent-encoding (`/%`, `/%zz`, a truncated UTF-8 escape) is
 *   `undefined` → 400. Letting `decodeURIComponent` throw would take the
 *   request — and, without the caller's catch, the process — down, and no
 *   legitimate client ever sends one.
 * - A backslash or a control character is `undefined`: on Windows `\` is a
 *   separator, and WHATWG URL has already folded raw ones into `/`, so a
 *   decoded one is nothing but an escape attempt.
 * - Dot segments (`.` / `..`) are refused rather than resolved. Resolution is
 *   the step that once turned a public prefix into a private file; a strict
 *   refusal keeps the public-asset check and the static join on one text.
 * - Empty segments collapse (`//x` → `/x`); the result always starts with `/`.
 * @param rawPathname - `url.pathname`, still percent-encoded.
 * @returns the canonical path, or `undefined` when the request is refused.
 */
export function canonicalPath(rawPathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    return undefined;
  }
  if (!decoded.startsWith('/') || decoded.includes('\\')) {
    return undefined;
  }
  for (let index = 0; index < decoded.length; index += 1) {
    const code = decoded.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return undefined;
  }
  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return undefined;
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

interface UpgradeCtx {
  controller: WebController;
  auth: LaunchAuth;
}

function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, ctx: UpgradeCtx): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  if (!verifyCookie(ctx.auth, req.headers.cookie)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  // `head` rides along: those are bytes the HTTP upgrade already consumed that
  // belong to the first WS frame — dropping them lost a pipelined frame.
  let connection: WsConnection | undefined;
  connection = upgrade(req, socket, head, {
    onMessage: (text: string) => {
      if (connection === undefined) return;
      const frame = parseClientFrame(text);
      if (isRejection(frame)) {
        connection.send(JSON.stringify({ type: 'error', message: frame.reason }));
        return;
      }
      void ctx.controller.handle(connection, frame);
    },
    onClose: () => {
      if (connection !== undefined) ctx.controller.detach(connection);
    },
  });
  if (connection !== undefined) ctx.controller.attach(connection);
}

function isRejection(value: unknown): value is FrameRejection {
  return typeof value === 'object' && value !== null && 'ok' in value && (value as FrameRejection).ok === false;
}
