/**
 * The WebSocket adapter's contract, tested over a REAL loopback socket with the
 * `ws` library's own client as the peer.
 *
 * The framing itself (fragment reassembly, UTF-8 validation, close codes,
 * masked/unmasked rules) is the library's tested responsibility now — testing
 * it again here would be testing the dependency. What remains OURS is the
 * adapter surface the rest of the product leans on: messages arrive, the
 * close handler fires, the message ceiling closes 1009, and sends after the
 * peer is gone are silently dropped rather than thrown.
 */
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { upgrade, WS_MAX_MESSAGE_BYTES, type WsConnection, type WsHandlers } from '../src/ws.js';

let server: Server | undefined;

afterEach(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((done) => server?.close(() => done()));
  server = undefined;
});

/** One HTTP server whose upgrade path is exactly the adapter. */
async function start(handlers: WsHandlers): Promise<number> {
  server = createServer();
  server.on('upgrade', (req, socket, head) => {
    upgrade(req, socket, head, handlers);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

function dial(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** The close code the peer received, or undefined if it never closed. */
function closeCode(ws: WebSocket): Promise<number | undefined> {
  return new Promise((resolve) => {
    ws.on('close', (code) => resolve(code));
  });
}

describe('ws adapter', () => {
  it('delivers client text messages to the handler', async () => {
    const messages: string[] = [];
    const port = await start({ onMessage: (text) => messages.push(text), onClose: () => undefined });
    const ws = await dial(port);
    ws.send('你好 kernel');
    await vi.waitFor(() => expect(messages).toEqual(['你好 kernel']));
    ws.close();
  });

  it('fires onClose when the peer closes', async () => {
    let closed = false;
    const port = await start({ onMessage: () => undefined, onClose: () => { closed = true; } });
    const ws = await dial(port);
    ws.close();
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it('closes the connection when a message exceeds the ceiling', async () => {
    const messages: string[] = [];
    const port = await start({ onMessage: (text) => messages.push(text), onClose: () => undefined });
    const ws = await dial(port);
    const code = closeCode(ws);
    ws.send(Buffer.alloc(WS_MAX_MESSAGE_BYTES + 1).toString('latin1'));
    const received = await code;
    // The library answers an oversized message with close 1009; when it tears
    // the socket down while the client is still writing, the client may see
    // the abrupt 1006 instead of the frame. Either way the connection is dead
    // — that is the contract; the precise code is the library's law.
    expect(received === 1009 || received === 1006).toBe(true);
    expect(messages).toEqual([]);
  });

  it('send() after the peer is gone is a no-op, not a throw', async () => {
    let connection: WsConnection | undefined;
    server = createServer();
    server.on('upgrade', (req, socket, head) => {
      connection = upgrade(req, socket, head, { onMessage: () => undefined, onClose: () => undefined });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const ws = await dial(port);
    expect(connection).toBeDefined();
    const closed = closeCode(ws);
    ws.terminate();
    await closed;
    expect(() => connection!.send('after close')).not.toThrow();
    expect(() => connection!.close()).not.toThrow();
  });
});
