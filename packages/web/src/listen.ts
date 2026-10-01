/**
 * The binding policy of the web server — how a port is chosen, split out of
 * `server.ts` (request handling) because it answers a different question.
 * Origin durability lives here: an explicit port is authoritative (failure is
 * the caller's answer), otherwise the REMEMBERED port is tried first and an
 * ephemeral bind is the fallback when it is busy. Whatever actually binds is
 * remembered for the next boot — best effort, never fatal.
 */
import type { Server } from 'node:http';
import { readPreferredPort, writePreferredPort } from './port.js';
import type { StartWebServerOptions, WebServerHandle } from './server.js';

export async function listenWithPreferredPort(
  server: Server,
  opts: StartWebServerOptions,
): Promise<WebServerHandle> {
  const remembered =
    opts.port === undefined ? await readPreferredPort(opts.portStore) : undefined;
  try {
    return await listenOnce(server, opts.port ?? remembered ?? 0, opts);
  } catch (err) {
    if (opts.port !== undefined || !isAddrInUse(err)) throw err;
    return await listenOnce(server, 0, opts);
  }
}

function listenOnce(server: Server, port: number, opts: StartWebServerOptions): Promise<WebServerHandle> {
  return new Promise((resolve, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, opts.host, () => {
      server.off('error', rejectPromise);
      const address = server.address();
      const bound = typeof address === 'object' && address !== null ? address.port : port;
      void writePreferredPort(bound, opts.portStore);
      resolve({
        server,
        port: bound,
        url: `http://${opts.host}:${bound}/?t=${opts.auth.token}`,
        close: () =>
          new Promise<void>((done) => {
            opts.controller.dispose().catch(() => undefined);
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

function isAddrInUse(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'EADDRINUSE';
}
