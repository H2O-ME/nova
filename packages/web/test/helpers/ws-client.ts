/**
 * A hand-rolled WebSocket CLIENT for `packages/web` tests: handshake + masked
 * frames + server-frame decode, with no external `ws` dependency.
 *
 * Deliberately independent of the server end: it is the second opinion on the
 * wire contract, and the auth handshake — cookie header on the upgrade — is
 * exactly the part a re-implementation gets subtly wrong. The key below is a
 * REAL 16-byte base64 value (the RFC 6455 example nonce): the `ws` library the
 * server end now uses validates the handshake per protocol, so a fake key
 * would be answered with a 400 before any frame could flow.
 */
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import type { ServerFrame } from '../../src/protocol.js';

export interface WsClient {
  nextFrame(): Promise<ServerFrame | undefined>;
  send(text: string): void;
  destroy(): void;
}

const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_ACCEPT = createHash('sha1').update(WS_KEY + WS_GUID).digest('base64');

/** Upgrade `/ws` (cookie-gated) and resolve once the 101 is verified. */
export function wsHandshake(
  port: number,
  pathname: string,
  cookie: string | undefined,
): Promise<WsClient> {
  return new Promise((resolve, rejectPromise) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.write(
        `GET ${pathname} HTTP/1.1\r\n` +
          'Host: 127.0.0.1\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${WS_KEY}\r\nSec-WebSocket-Version: 13\r\n` +
          (cookie !== undefined ? `Cookie: ${cookie}\r\n` : '') +
          '\r\n',
      );
    });
    let handshakeDone = false;
    let buf = Buffer.alloc(0);
    const queue: ServerFrame[] = [];
    let wake: ((f: ServerFrame | undefined) => void) | undefined;
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const head = buf.subarray(0, end).toString('latin1');
        buf = buf.subarray(end + 4);
        if (!head.startsWith('HTTP/1.1 101')) {
          rejectPromise(new Error(/closed|401/.test(head) ? head.split('\r\n')[0] ?? 'closed' : 'closed'));
          socket.destroy();
          return;
        }
        if (!head.includes(`Sec-WebSocket-Accept: ${WS_ACCEPT}`)) {
          rejectPromise(new Error('bad accept header'));
          socket.destroy();
          return;
        }
        handshakeDone = true;
        resolve({
          nextFrame: () =>
            new Promise((res) => {
              const pending = queue.shift();
              if (pending !== undefined) res(pending);
              else wake = res;
            }),
          send: (text: string) => socket.write(clientFrame(text)),
          destroy: () => socket.destroy(),
        });
      }
      for (;;) {
        const frame = decodeServerFrame(buf);
        if (frame === null) break;
        buf = buf.subarray(frame.consumed);
        if (frame.opcode === 0x1) {
          const value = JSON.parse(frame.payload.toString('utf8')) as ServerFrame;
          if (wake !== undefined) {
            const fn = wake;
            wake = undefined;
            fn(value);
          } else queue.push(value);
        }
      }
    });
    socket.on('error', rejectPromise);
    socket.on('close', () => {
      wake?.(undefined);
      if (!handshakeDone) rejectPromise(new Error('closed'));
    });
  });
}

/** What a caller is waiting for on the wire (see {@link exchange}). */
export interface ExchangeOptions {
  /** How long to collect when no `until` predicate is given. */
  collectMs?: number;
  /**
   * Stop as soon as the frames collected so far satisfy this.
   *
   * A case that ASSERTS on a reply must use this. `collectMs` is a wall-clock
   * guess about how fast the server can answer, and under a loaded lane the
   * guess is wrong in the direction that reads as a product failure: the
   * `sessions` case below needed >250ms for one `list_sessions` round trip and
   * reported `expected false to be true` on an assertion instead.
   */
  until?: (frames: ServerFrame[]) => boolean;
  /** Ceiling for an `until` wait: a wrong guess must fail an assertion, not the clock. */
  deadlineMs?: number;
}

/**
 * Send `frames` and collect replies until `until` holds (or `deadlineMs` runs
 * out), then close. Without `until` it keeps the old fixed `collectMs` window —
 * use that only for "send and observe whatever arrives".
 */
export async function exchange(
  port: number,
  cookie: string,
  frames: unknown[],
  options: ExchangeOptions = {},
): Promise<ServerFrame[]> {
  const collectMs = options.collectMs ?? 250;
  const deadlineMs = options.deadlineMs ?? 10_000;
  const client = await wsHandshake(port, '/ws', cookie);
  const received: ServerFrame[] = [];
  // Drain into `received` as frames arrive; `nextFrame()` resolves `undefined`
  // only on close, so the loop ends when this helper destroys the socket.
  const drained = (async () => {
    for (;;) {
      const frame = await client.nextFrame();
      if (frame === undefined) return;
      received.push(frame);
    }
  })();
  for (const frame of frames) client.send(JSON.stringify(frame));
  await new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      const elapsed = Date.now() - started;
      // Polled rather than raced against an event: the drain loop owns the
      // socket, and a promise race would leave frames decoded-but-unread.
      const done = options.until !== undefined
        ? options.until(received) || elapsed >= deadlineMs
        : elapsed >= collectMs;
      if (done) resolve();
      else setTimeout(tick, 10);
    };
    tick();
  });
  client.destroy();
  await drained;
  return received;
}

function decodeServerFrame(buf: Buffer): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buf.length < 2) return null;
  const opcode = buf[0] !== undefined ? buf[0] & 0x0f : 0;
  let len = (buf[1] ?? 0) & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  if (buf.length < offset + len) return null;
  return { opcode, payload: buf.subarray(offset, offset + len), consumed: offset + len };
}

function clientFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([9, 8, 7, 6]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] = (masked[i] ?? 0) ^ (mask[i & 3] ?? 0);
  // 7-bit length up to 125, then the 16-bit extended form. The 64-bit form is
  // not needed: no test sends a frame large enough to require it.
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length, ...mask]), masked]);
  }
  const head = Buffer.alloc(4);
  head[0] = 0x81;
  head[1] = 0x80 | 126;
  head.writeUInt16BE(payload.length, 2);
  return Buffer.concat([head, mask, masked]);
}
