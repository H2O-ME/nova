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
import type { ClientFrame, ServerFrame } from './types.js';

export interface AgentClient {
  state: ReturnType<typeof reduce>;
  dispatch: (action: Action) => void;
  send: (frame: ClientFrame) => void;
  connection: 'connecting' | 'open' | 'closed';
}

export function useAgent(): AgentClient {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [connection, setConnection] = useState<AgentClient['connection']>('connecting');
  const socketRef = useRef<WebSocket | undefined>(undefined);

  useEffect(() => {
    let closedByUs = false;
    let retryMs = 500;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = (): void => {
      setConnection('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      socketRef.current = ws;
      ws.onopen = () => {
        retryMs = 500;
        setConnection('open');
        dispatch({ type: 'connection', connected: true });
      };
      ws.onmessage = (msg: MessageEvent<string>) => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(msg.data) as ServerFrame;
        } catch {
          return; // foreign bytes on the socket: ignore, never eval
        }
        handleFrame(frame, dispatch);
      };
      ws.onclose = () => {
        setConnection('closed');
        // The reducer's `connected` gates every control: a dropped socket must
        // dark them all, not leave buttons that silently do nothing.
        dispatch({ type: 'connection', connected: false });
        if (!closedByUs) {
          timer = setTimeout(open, retryMs);
          retryMs = Math.min(retryMs * 2, 5000);
        }
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

  return { state, dispatch, send, connection };
}

/**
 * Route one inbound frame through the pure table (`frame-actions.ts`), so the
 * socket carries no routing of its own.
 */
function handleFrame(frame: ServerFrame, dispatch: (a: Action) => void): void {
  const action = frameAction(frame);
  if (action !== null) dispatch(action);
}
