/**
 * The WebSocket end of the event stream, backed by the maintained `ws`
 * library (2026-10-05, approved deviation from the hand-written RFC6455
 * parser this replaced). The hand-rolled end knew its scope honestly —
 * localhost, single user, text frames — but the protocol details it kept
 * getting wrong are exactly the ones a library owns: fragment state (a new
 * TEXT frame mid-message used to silently DROP the pending one), the bytes
 * already consumed by the HTTP upgrade (the `head` buffer never reached the
 * parser), UTF-8/close-payload validation, and a write path with no
 * backpressure ceiling. Those are protocol-law, not product behaviour, so
 * this file is now a thin adapter: our frame ceiling, our send ceiling, our
 * handler contract — the library's framing.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';

/** Client→server single message ceiling (fragment reassembly included). */
export const WS_MAX_MESSAGE_BYTES = 1024 * 1024;
/**
 * Outgoing queue ceiling per connection. The kernel keeps publishing while a
 * consumer is slow, and `ws` buffers — without a ceiling, one stalled tab
 * grows the process heap without bound while every healthy tab keeps
 * streaming. Past the ceiling the connection is CUT, not stalled: the client
 * reconnects, and a reconnect replays `ready` against the durable log, so
 * nothing is lost — this is the same converge-by-replay contract a dropped
 * socket already has.
 */
export const WS_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface WsConnection {
  send(text: string): void;
  close(code?: number): void;
}

export interface WsHandlers {
  onMessage(text: string): void;
  onClose(): void;
}

/**
 * Complete the 101 handshake — including any bytes the HTTP upgrade already
 * consumed (`head`; dropping them used to lose the first frame of a client
 * that pipelined one) — and take over the socket. The caller has already
 * validated path and auth; a request that fails the library's own handshake
 * check is answered by the library and never reaches the handlers.
 */
export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, handlers: WsHandlers): WsConnection {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_MESSAGE_BYTES });
  let ws: WebSocket | undefined;
  const connection: WsConnection = {
    send(text: string): void {
      // `bufferedAmount` is the library's own queue depth. Past the ceiling we
      // terminate rather than queue: a consumer that slow is gone in every way
      // that matters, and the close handler converges the rest.
      if (ws === undefined || ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
        ws.terminate();
        return;
      }
      ws.send(text);
    },
    close(code = 1000): void {
      ws?.close(code);
    },
  };
  wss.once('connection', (opened: WebSocket) => {
    ws = opened;
    opened.on('message', (data, isBinary) => {
      if (isBinary) return; // the protocol layer already closed 1003 for these
      handlers.onMessage(data.toString('utf8'));
    });
    opened.on('close', () => handlers.onClose());
    opened.on('error', () => {
      // A read/parse error the library did not already convert into a close
      // handshake; tearing down makes the `close` event (and our handler) fire.
      opened.terminate();
    });
  });
  wss.handleUpgrade(req, socket, head, (opened) => {
    wss.emit('connection', opened, req);
  });
  return connection;
}
