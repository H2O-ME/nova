/**
 * Minimal RFC6455 WebSocket server end (no deps — same posture as the hand-written
 * SSE parser in the ai package). Scope is honest: localhost single-
 * user text frames only. Implemented: handshake accept, masked client-frame
 * decode with fragment reassembly, extended lengths, ping→pong echo, close
 * handshake, size ceilings. Rejected: TLS (loopback only), permessage-
 * deflate (no RSV bits — non-zero reserved bits are a protocol error),
 * binary frames (opcode 2 → close 1003).
 */
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Client→server single message ceiling (fragment reassembly included). */
export const WS_MAX_MESSAGE_BYTES = 1024 * 1024;

export interface WsConnection {
  send(text: string): void;
  close(code?: number): void;
}

export interface WsHandlers {
  onMessage(text: string): void;
  onClose(): void;
}

/** The Sec-WebSocket-Accept value for a client key (undefined for a bad key). */
export function acceptKey(key: string | undefined): string | undefined {
  if (key === undefined || key.length === 0 || key.length > 128) return undefined;
  return createHash('sha1').update(key + GUID).digest('base64');
}

/**
 * Perform the 101 handshake and take over the socket. `fail` writes a plain
 * HTTP error instead (caller already validated origin/auth/upgrade headers).
 */
export function upgrade(socket: Duplex, key: string | undefined, handlers: WsHandlers): WsConnection | undefined {
  const accept = acceptKey(key);
  if (accept === undefined) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return undefined;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return attachFrames(socket, handlers);
}

// ------------------------------------------------------------------- framing

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Encode one unmasked server→client text frame (64-bit extended length). */
export function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Bind the frame state machine to an already-upgraded socket. */
function attachFrames(socket: Duplex, handlers: WsHandlers): WsConnection {
  let buf: Buffer = Buffer.alloc(0);
  let frags: Buffer[] = [];
  let fragBytes = 0;
  let fragOpcode = -1;
  let closed = false;

  const shutdown = (code: number): void => {
    if (closed) return;
    closed = true;
    try {
      socket.write(encodeClose(code));
    } catch {
      // best-effort close echo
    }
    socket.destroy();
    handlers.onClose();
  };

  const onText = (text: string): void => {
    if (!closed) handlers.onMessage(text);
  };

  socket.on('data', (chunk: Buffer) => {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    for (;;) {
      const frame = decodeFrame(buf);
      if (frame === 'need-more') return;
      if (frame === 'bad') return shutdown(1002);
      buf = buf.subarray(frame.consumed);
      const { fin, opcode, payload } = frame;
      if (opcode >= 0x8) {
        // Control frames must be unfragmented and small (RFC 6455 §5.5).
        if (!fin || payload.length > 125) return shutdown(1002);
        if (opcode === OP_CLOSE) {
          if (!closed) {
            closed = true;
            try {
              socket.write(payload.length >= 2 ? encodeClose(payload.readUInt16BE(0)) : encodeClose(1000));
            } catch {
              // echo already in flight or socket dead
            }
            socket.destroy();
            handlers.onClose();
          }
          return;
        }
        if (opcode === OP_PING) {
          if (!closed) socket.write(encodeFrame(OP_PONG, payload));
        }
        continue; // pong: nothing to do
      }
      if (opcode === OP_BINARY) return shutdown(1003);
      if (opcode === OP_TEXT) {
        fragOpcode = OP_TEXT;
        frags = [];
        fragBytes = 0;
      } else if (opcode !== OP_CONT || fragOpcode === -1) {
        return shutdown(1002);
      }
      frags.push(payload);
      fragBytes += payload.length;
      if (fragBytes > WS_MAX_MESSAGE_BYTES) return shutdown(1009);
      if (fin) {
        const text = Buffer.concat(frags, fragBytes).toString('utf8');
        frags = [];
        fragBytes = 0;
        fragOpcode = -1;
        onText(text);
      }
    }
  });
  socket.on('error', () => shutdown(1011));
  socket.on('close', () => {
    if (!closed) {
      closed = true;
      handlers.onClose();
    }
  });

  return {
    send(text: string): void {
      if (!closed) socket.write(encodeTextFrame(text));
    },
    close(code = 1000): void {
      shutdown(code);
    },
  };
}

interface DecodedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  consumed: number;
}

type DecodeResult = DecodedFrame | 'need-more' | 'bad';

/** Decode one masked client frame (server must reject unmasked — §5.1). */
function decodeFrame(buf: Buffer): DecodeResult {
  if (buf.length < 2) return 'need-more';
  const b0 = buf[0] ?? 0;
  const b1 = buf[1] ?? 0;
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const rsv = b0 & 0x70;
  if (rsv !== 0) return 'bad'; // no extensions negotiated
  if ((b1 & 0x80) === 0) return 'bad'; // client frames must be masked
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < offset + 2) return 'need-more';
    len = buf.readUInt16BE(offset);
    offset += 2;
    if (len < 126) return 'bad'; // minimal-encoding rule
  } else if (len === 127) {
    if (buf.length < offset + 8) return 'need-more';
    const big = buf.readBigUInt64BE(offset);
    if (big > BigInt(WS_MAX_MESSAGE_BYTES)) return 'bad';
    len = Number(big);
    offset += 8;
    if (len < 65536) return 'bad';
  }
  if (buf.length < offset + 4 + len) return 'need-more';
  const mask = buf.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buf.subarray(offset, offset + len)); // copy: we own it
  for (let i = 0; i < len; i += 1) {
    payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
  }
  return { fin, opcode, payload, consumed: offset + len };
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  if (len < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, len]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x80 | opcode;
  header[1] = 126;
  header.writeUInt16BE(len, 2);
  return Buffer.concat([header, payload]);
}

function encodeClose(code: number): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return encodeFrame(OP_CLOSE, payload);
}
