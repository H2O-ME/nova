import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { acceptKey, encodeTextFrame, upgrade, type WsConnection } from '../src/ws.js';

/** RFC 6455 §1.3 canonical key/accept pair. */
const RFC_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const RFC_ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';

/**
 * Duplex whose writes land in `written` (peer side) instead of looping back
 * into its own reader — a PassThrough would feed the server's 101 response
 * straight into its frame decoder. `feed()` delivers peer→server bytes.
 */
class FakeSocket extends Duplex {
  readonly written: Buffer[] = [];
  override _read(): void {
    /* reads never happen: we never push non-frame data */
  }
  override _write(chunk: Buffer, _enc: unknown, cb: (e?: Error | null) => void): void {
    this.written.push(Buffer.from(chunk));
    cb();
  }
  override destroy(_error?: Error | null): this {
    return this;
  }
  feed(chunk: Buffer): void {
    this.push(chunk);
  }
  writtenText(): string {
    return Buffer.concat(this.written).toString('latin1');
  }
}

describe('handshake accept', () => {
  it('reproduces the RFC vector', () => {
    expect(acceptKey(RFC_KEY)).toBe(RFC_ACCEPT);
  });
  it('rejects missing/empty/oversized keys', () => {
    expect(acceptKey(undefined)).toBeUndefined();
    expect(acceptKey('')).toBeUndefined();
    expect(acceptKey('x'.repeat(200))).toBeUndefined();
  });
});

describe('encodeTextFrame', () => {
  it('small text: FIN|TEXT, unmasked, 7-bit length', () => {
    const frame = encodeTextFrame('hi');
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(2); // no mask bit (server→client)
    expect(frame.subarray(2).toString('utf8')).toBe('hi');
  });
  it('medium text uses the 16-bit extended length', () => {
    const frame = encodeTextFrame('x'.repeat(200));
    expect((frame[1] ?? 0) & 0x7f).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(200);
  });
});

describe('upgrade (over a duplex)', () => {
  it('writes the 101 response and delivers a masked client frame to the handler', async () => {
    const socket = new FakeSocket();
    const received: string[] = [];
    const connection: WsConnection | undefined = upgrade(socket, RFC_KEY, {
      onMessage: (t) => received.push(t),
      onClose: () => undefined,
    });
    expect(connection).toBeDefined();
    expect(socket.writtenText()).toContain(`Sec-WebSocket-Accept: ${RFC_ACCEPT}`);

    // A masked TEXT frame "ping" (client frames MUST be masked per §5.1).
    socket.feed(clientTextFrame('ping'));
    await waitFor(() => received.length === 1);
    expect(received[0]).toBe('ping');
    // Fragmented text reassembles into one message.
    socket.feed(clientFrame(0x81, 'ab')); // fin=1 single frame
    await waitFor(() => received.length === 2);
    socket.feed(clientFrame(0x01, 'x')); // fin=0 text start
    socket.feed(clientFrame(0x80, 'y')); // continuation, fin=1
    await waitFor(() => received.length === 3);
    expect(received[2]).toBe('xy');
    connection?.close();
  });

  it('ping echoes as pong with the same payload', async () => {
    const socket = new FakeSocket();
    upgrade(socket, RFC_KEY, { onMessage: () => undefined, onClose: () => undefined });
    socket.feed(clientFrame(0x89, 'q')); // ping, fin=1
    await waitFor(() => socket.written.length > 1);
    const pong = socket.written[1] as Buffer;
    expect(pong[0]).toBe(0x8a); // fin|pong, unmasked
    expect(pong.subarray(2).toString('utf8')).toBe('q');
  });

  it('an unmasked client frame is a protocol error (close 1002)', async () => {
    const socket = new FakeSocket();
    let closed = false;
    upgrade(socket, RFC_KEY, { onMessage: () => undefined, onClose: () => { closed = true; } });
    const payload = Buffer.from('bad');
    socket.feed(Buffer.from([0x81, payload.length, ...payload])); // no mask bit
    await waitFor(() => closed);
    expect(closed).toBe(true);
  });

  it('a bad key answers 400 and never attaches', () => {
    const socket = new FakeSocket();
    const connection = upgrade(socket, undefined, { onMessage: () => undefined, onClose: () => undefined });
    expect(connection).toBeUndefined();
    expect(socket.writtenText()).toContain('400 Bad Request');
  });
});

async function waitFor(pred: () => boolean, ms = 500): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** One masked frame: byte0 = fin|opcode, masked payload (browser-shaped). */
function clientFrame(firstByte: number, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] = (masked[i] ?? 0) ^ (mask[i & 3] ?? 0);
  return Buffer.concat([Buffer.from([firstByte, 0x80 | payload.length, ...mask]), masked]);
}

function clientTextFrame(text: string): Buffer {
  return clientFrame(0x81, text);
}
