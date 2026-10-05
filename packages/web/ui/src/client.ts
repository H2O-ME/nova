/**
 * The browser's only socket: connect to /ws (same-origin — the launch
 * cookie rides automatically), feed frames into the reducer, expose a send.
 * Reconnect with capped backoff; a `ready` on each (re)open re-baselines the
 * transcript from the durable log, so a dropped run is never "lost" — the
 * next open catches it up.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { frameAction } from './frame-actions.js';
import { reduce, initialState, type Action } from './state.js';
import { StreamCoalescer } from './stream-coalesce.js';
import type { ClientFrame, ServerFrame } from './types.js';

/** First reconnect delay: fast enough to feel automatic on a blip. */
const RETRY_MIN_MS = 500;

/** Largest reconnect delay: a long outage keeps trying, twice a minute. */
const RETRY_MAX_MS = 5000;

/**
 * The backoff schedule, as a pure function.
 *
 * Split out because the socket effect cannot be asserted without a DOM, and this
 * is the part with a rule in it: a normal drop waits `retryMs` and then doubles,
 * capped at {@link RETRY_MAX_MS}; a MANUAL retry waits nothing and re-seeds the
 * schedule rather than inheriting the grown delay — otherwise a reader pressing
 * 重试 against a long outage would be pushed further away by their own click.
 * @param previousMs - the delay used before this close.
 * @param immediate - the close was caused by a manual retry.
 * @returns the delay to wait, and the delay to use next time.
 */
export function nextRetry(previousMs: number, immediate: boolean): { delayMs: number; nextMs: number } {
  if (immediate) return { delayMs: 0, nextMs: RETRY_MIN_MS };
  return { delayMs: previousMs, nextMs: Math.min(previousMs * 2, RETRY_MAX_MS) };
}

export interface AgentClient {
  state: ReturnType<typeof reduce>;
  dispatch: (action: Action) => void;
  send: (frame: ClientFrame) => void;
  connection: 'connecting' | 'open' | 'closed';
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
}

export function useAgent(): AgentClient {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [connection, setConnection] = useState<AgentClient['connection']>('connecting');
  const socketRef = useRef<WebSocket | undefined>(undefined);
  // Set by `reconnect()` to collapse the pending backoff the next time the
  // socket closes, so a manual retry is immediate rather than "as soon as the
  // timer happens to fire".
  const retryNowRef = useRef(false);

  useEffect(() => {
    let closedByUs = false;
    let retryMs = RETRY_MIN_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = (): void => {
      setConnection('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      socketRef.current = ws;
      // Stream deltas render at FRAME rate, not chunk rate (stream-coalesce.ts):
      // the buffer releases at most once per painted frame, and any other frame
      // flushes it first so the reducer still sees the kernel's exact order.
      const coalescer = new StreamCoalescer((frames) => {
        for (const flushed of frames) handleFrame(flushed, dispatch);
      });
      ws.onopen = () => {
        retryMs = RETRY_MIN_MS;
        setConnection('open');
        // NO reducer dispatch here. The socket being open is not the session
        // being serviceable: until the host's `ready` lands, `meta` is null and
        // a prompt sent now is answered by nobody (the connect handler has not
        // attached the socket to a session yet). `connected` is lit by the
        // `ready` reduction alone — the one fact every control gates on.
      };
      ws.onmessage = (msg: MessageEvent<string>) => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(msg.data) as ServerFrame;
        } catch {
          return; // foreign bytes on the socket: ignore, never eval
        }
        if (!coalescer.absorb(frame)) {
          coalescer.flushNow();
          handleFrame(frame, dispatch);
        }
      };
      ws.onclose = () => {
        // The tail the buffer still holds belongs to the transcript that just
        // ended: land it before the disconnect state reads "the run is over".
        coalescer.flushNow();
        setConnection('closed');
        // The reducer's `connected` gates every control: a dropped socket must
        // dark them all, not leave buttons that silently do nothing.
        dispatch({ type: 'connection', connected: false });
        if (closedByUs) return;
        if (timer !== undefined) clearTimeout(timer);
        // A manual retry collapses the wait and re-seeds the backoff, so a
        // reader who keeps pressing 重试 is not left on an ever-growing delay.
        const step = nextRetry(retryMs, retryNowRef.current);
        retryNowRef.current = false;
        timer = setTimeout(open, step.delayMs);
        retryMs = step.nextMs;
      };
    };
    open();
    return () => {
      closedByUs = true;
      if (timer !== undefined) clearTimeout(timer);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((frame: ClientFrame): void => {
    const ws = socketRef.current;
    if (ws === undefined || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(frame));
    // Request-side bookkeeping (the pagination in-flight flag) belongs to the
    // same reducer as the replies — one owner for client state.
    dispatch({ type: 'sent', frame });
  }, []);

  const reconnect = useCallback((): void => {
    retryNowRef.current = true;
    const ws = socketRef.current;
    if (ws === undefined) return;
    // A CONNECTING socket cannot be re-dialled usefully yet; `close()` on it
    // still fires `onclose`, which is what re-arms the schedule.
    ws.close();
  }, []);

  return { state, dispatch, send, connection, reconnect };
}

/**
 * Route one inbound frame through the pure table (`frame-actions.ts`), so the
 * socket carries no routing of its own.
 */
function handleFrame(frame: ServerFrame, dispatch: (a: Action) => void): void {
  const action = frameAction(frame);
  if (action !== null) dispatch(action);
}
