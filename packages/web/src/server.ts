/**
 * Single-process HTTP + WebSocket server for the WebUI (M11 批2). One Node
 * process: `node:http` serves the built React bundle (static files) and the
 * kernel event stream (WS on `/ws`), both gated by a signed cookie from the
 * launch token. There is no separate API surface — the durable log is the
 * only state and the WS stream is the only channel, so a reconnect is just a
 * new socket that replays `ready` then follows events.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseClientFrame, type FrameRejection } from './client-frame.js';
import { cookieHeader, cookieValue, verifyCookie, type LaunchAuth } from './auth.js';
import type { WebController } from './controller.js';
import { upgrade, type WsConnection } from './ws.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
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
}

export function startWebServer(opts: StartWebServerOptions): Promise<WebServerHandle> {
  const { controller, auth, staticDir, host } = opts;
  const server = createServer((req, res) => {
    void handleHttp(req, res, { controller, auth, staticDir });
  });
  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head, { controller, auth });
  });
  return new Promise((resolve, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(opts.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : (opts.port ?? 0);
      resolve({
        server,
        port,
        url: `http://${host}:${port}/?t=${auth.token}`,
        close: () =>
          new Promise<void>((done) => {
            controller.dispose().catch(() => undefined);
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

interface HttpCtx {
  controller: WebController;
  auth: LaunchAuth;
  staticDir: string;
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
  if (!verifyCookie(ctx.auth, req.headers.cookie)) {
    deny(res, 401, 'unauthorized');
    return;
  }
  // Static file serving. `/` → index.html; everything else resolved under
  // staticDir (traversal rejected). Unknown/missing → 404 (SPA single page).
  let relPath = decodeURIComponent(url.pathname);
  if (relPath === '/' || relPath === '') relPath = '/index.html';
  const abs = path.join(ctx.staticDir, path.normalize(relPath));
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

interface UpgradeCtx {
  controller: WebController;
  auth: LaunchAuth;
}

function handleUpgrade(req: IncomingMessage, socket: Duplex, _head: Buffer, ctx: UpgradeCtx): void {
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
  let connection: WsConnection | undefined;
  connection = upgrade(socket, req.headers['sec-websocket-key'], {
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
