/**
 * The stdio pipe end of the event stream: one JSON frame per line.
 *
 * This is the desktop shell's channel, and it replaces the WebSocket adapter
 * (`ws.ts`) rather than sitting beside it. The reasoning is the same shape as
 * that file's own: the transport is the shell's choice, the frames are the
 * contract. A native window loads the UI from disk (`frontendDist`), so there is
 * no origin, no cookie, no port and no handshake to own — the child process's
 * stdin/stdout IS the socket, and `exec --json` already proved the line-JSON
 * discipline is enough for a full run.
 *
 * Why `WsConnection` survives the change: the controller, the fanout and all 13
 * frame handlers only ever need `send`/`close`. Renaming that pair would touch
 * 18 files to say the same thing, so the interface moved (`connection.ts`) and
 * the name did not.
 *
 * The one rule this file must keep: **stdout is the frame channel and nothing
 * else**. A stray `console.log` anywhere in the boot path would inject a
 * non-JSON line into the pipe, and the shell — which parses every line — would
 * see a frame it cannot read. Diagnostics go to stderr (see `desktop-host.ts`).
 */
import type { WsConnection } from './connection.js';
import { parseClientFrame } from './client-frame.js';
import { MAX_IMAGE_FRAME_BYTES } from './wire-limits.js';
import type { ClientFrame } from './protocol.js';
import type { FrameRejection } from './reject.js';

/** One inbound line ceiling: the largest frame kind the validator admits. */
export const MAX_PIPE_LINE_BYTES = MAX_IMAGE_FRAME_BYTES;

export interface PipeHandlers {
  /** One complete line arrived (newline already stripped). */
  onMessage(text: string): void;
  /** The writer is gone — stdin hit EOF (the shell exited or closed it). */
  onClose(): void;
}

/** A writable stream with the one method the connection needs. */
export interface PipeWriter {
  write(chunk: string): boolean;
}

/**
 * One pipe-backed connection.
 *
 * `close()` cannot close the stream — it is the process's own stdout, and
 * ending it would take every later diagnostic with it. What it does do is stop
 * this connection from being written to, which is the only thing the controller
 * asks of it: after `close()`, `send` is a no-op and the fanout converges.
 * @param out - where frames are written (stdout in production).
 * @returns the connection the controller attaches.
 */
export function pipeConnection(out: PipeWriter): WsConnection {
  let open = true;
  return {
    send(text: string): void {
      if (!open) return;
      out.write(`${text}\n`);
    },
    close(): void {
      open = false;
    },
  };
}

/**
 * Split an incoming byte stream into lines and hand each one to `handlers`.
 *
 * Written as a tiny state machine rather than `readline` because the only rule
 * that matters here is the byte ceiling per line, and `readline` has no such
 * ceiling: a client that never sends a newline would grow the buffer until the
 * process dies. An over-limit line is REFUSED and skipped to the next newline —
 * the same "cut, never queue" answer `ws.ts` gave a slow consumer.
 * @param handlers - the frame sink and the EOF signal.
 * @returns the sink to feed decoded text chunks into, and a `flush` for the tail.
 */
export function lineSplitter(handlers: PipeHandlers): {
  push(chunk: string): void;
  end(): void;
} {
  let pending = '';
  let discarding = false;
  const deliver = (line: string): void => {
    // A blank line is not a frame: a shell that echoes a newline, or a writer
    // that flushes twice, must not produce a "frame is not valid JSON" error.
    if (line.trim().length === 0) return;
    handlers.onMessage(line);
  };
  return {
    push(chunk: string): void {
      pending += chunk;
      for (;;) {
        const index = pending.indexOf('\n');
        if (index < 0) break;
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (discarding) {
          // This line's START was already refused; the rest of it is the same
          // oversized frame, so it goes with it.
          discarding = false;
          continue;
        }
        deliver(line);
      }
      if (pending.length > MAX_PIPE_LINE_BYTES) {
        discarding = true;
        pending = '';
      }
    },
    end(): void {
      if (pending.length > 0 && !discarding) deliver(pending);
      pending = '';
      handlers.onClose();
    },
  };
}

/**
 * Validate one inbound line, or answer the sender with the reason.
 *
 * The mirror of `server.ts`'s upgrade handler: the transport never trusts a
 * line, the controller never sees an invalid frame, and a refusal is an `error`
 * frame rather than a silent drop — the shell's console is the only place a
 * malformed line could otherwise be noticed.
 * @param line - one line of the pipe.
 * @param connection - where a refusal is written back.
 * @returns the validated frame, or `undefined` when the line was refused.
 */
export function parsePipeLine(line: string, connection: WsConnection): ClientFrame | undefined {
  const frame = parseClientFrame(line);
  if (isRejection(frame)) {
    connection.send(JSON.stringify({ type: 'error', message: frame.reason }));
    return undefined;
  }
  return frame;
}

function isRejection(value: unknown): value is FrameRejection {
  return typeof value === 'object' && value !== null && 'ok' in value && (value as FrameRejection).ok === false;
}
