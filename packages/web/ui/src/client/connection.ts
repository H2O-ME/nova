/**
 * The socket's life cycle, with no React in it: dial `/ws`, survive drops with
 * capped backoff, coalesce stream deltas at frame rate, and hand every parsed
 * frame to the caller. React binding lives in `../client.ts` (the hook); this
 * module is plain callbacks so the reconnection rules are assertable without a
 * DOM.
 *
 * A `ready` on each (re)open re-baselines the transcript from the durable log,
 * so a dropped run is never "lost" — the next open catches it up.
 */
import { StreamCoalescer } from '../stream-coalesce.js';

/** First reconnect delay: fast enough to feel automatic on a blip. */
export const RETRY_MIN_MS = 500;

/** Largest reconnect delay: a long outage keeps trying, twice a minute. */
export const RETRY_MAX_MS = 5000;

/**
 * The backoff schedule, as a pure function.
 *
 * A normal drop waits `retryMs` and then doubles, capped at
 * {@link RETRY_MAX_MS}; a MANUAL retry waits nothing and re-seeds the schedule
 * rather than inheriting the grown delay — otherwise a reader pressing 重试
 * against a long outage would be pushed further away by their own click.
 * @param previousMs - the delay used before this close.
 * @param immediate - the close was caused by a manual retry.
 * @returns the delay to wait, and the delay to use next time.
 */
export function nextRetry(previousMs: number, immediate: boolean): { delayMs: number; nextMs: number } {
  if (immediate) return { delayMs: 0, nextMs: RETRY_MIN_MS };
  return { delayMs: previousMs, nextMs: Math.min(previousMs * 2, RETRY_MAX_MS) };
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface ConnectionEvents {
  /** A parsed (and coalesced) inbound frame, in the host's order. */
  onFrame: (frame: unknown) => void;
  /** The dialing status changed. */
  onStatus: (status: ConnectionStatus) => void;
}

export interface Connection {
  /**
   * Send one client frame. Returns false when the socket is not OPEN — the
   * caller decides what "not sent" means (the reducer's `sent` bookkeeping
   * fires only for frames that actually left).
   */
  send: (frame: unknown) => boolean;
  /**
   * Drop the current socket and dial again at once, skipping the backoff.
   *
   * The backoff is capped at 5s, so without this the indicator's retry is only
   * a promise: a reader watching a dead socket waits up to five seconds with no
   * way to hurry it. Reconnecting instead of merely re-dialling matters when the
   * socket is still OPEN but the peer is a zombie — `close()` runs the same
   * `onclose` that re-arms the schedule, so there is exactly one reconnect path.
   */
  reconnect: () => void;
  /** Stop for good: no more dials, listeners released. */
  dispose: () => void;
}

export function createConnection(events: ConnectionEvents): Connection {
  let closedByUs = false;
  let retryMs = RETRY_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ws: WebSocket | undefined;
  // Set by `reconnect()` to collapse the pending backoff the next time the
  // socket closes, so a manual retry is immediate rather than "as soon as the
  // timer happens to fire".
  let retryNow = false;

  const open = (): void => {
    events.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    ws = socket;
    // Stream deltas render at FRAME rate, not chunk rate (stream-coalesce.ts):
    // the buffer releases at most once per painted frame, and any other frame
    // flushes it first so the reducer still sees the kernel's exact order.
    const coalescer = new StreamCoalescer((frames) => {
      for (const flushed of frames) events.onFrame(flushed);
    });
    socket.onopen = () => {
      retryMs = RETRY_MIN_MS;
      events.onStatus('open');
      // NO state change beyond the status here. The socket being open is not
      // the session being serviceable: until the host's `ready` lands, `meta`
      // is null and a prompt sent now is answered by nobody (the connect
      // handler has not attached the socket to a session yet). `connected` is
      // lit by the `ready` reduction alone — the one fact every control gates on.
    };
    socket.onmessage = (msg: MessageEvent<string>) => {
      let frame: unknown;
      try {
        frame = JSON.parse(msg.data) as unknown;
      } catch {
        return; // foreign bytes on the socket: ignore, never eval
      }
      if (!coalescer.absorb(frame as never)) {
        coalescer.flushNow();
        events.onFrame(frame);
      }
    };
    socket.onclose = () => {
      // The tail the buffer still holds belongs to the transcript that just
      // ended: land it before the disconnect state reads "the run is over".
      coalescer.flushNow();
      events.onStatus('closed');
      if (closedByUs) return;
      if (timer !== undefined) clearTimeout(timer);
      // A manual retry collapses the wait and re-seeds the backoff, so a
      // reader who keeps pressing 重试 is not left on an ever-growing delay.
      const step = nextRetry(retryMs, retryNow);
      retryNow = false;
      timer = setTimeout(open, step.delayMs);
      retryMs = step.nextMs;
    };
  };

  open();

  return {
    send: (frame) => {
      const socket = ws;
      if (socket === undefined || socket.readyState !== socket.OPEN) return false;
      socket.send(JSON.stringify(frame));
      return true;
    },
    reconnect: () => {
      retryNow = true;
      // A CONNECTING socket cannot be re-dialled usefully yet; `close()` on it
      // still fires `onclose`, which is what re-arms the schedule.
      ws?.close();
    },
    dispose: () => {
      closedByUs = true;
      if (timer !== undefined) clearTimeout(timer);
      ws?.close();
    },
  };
}
