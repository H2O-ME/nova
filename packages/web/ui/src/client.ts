/**
 * The React binding over the client model (`./client/model.ts`) — the only
 * place React and the model meet. The model owns the socket, the reducer and
 * the send path; this hook reads snapshots, forwards callbacks and disposes on
 * unmount. Keeping it thin is the point: everything with a rule in it is
 * React-free and directly assertable.
 *
 * The model is created INSIDE the effect, not in render or a ref: StrictMode
 * mounts, unmounts and remounts the same fiber (state and refs survive), so a
 * client disposed in the cleanup must never be reused — each effect cycle gets
 * a fresh one. The window before the first effect (and SSR) renders against a
 * stable idle model: `initialState` snapshots, no-op gestures, `connecting`.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createAgentClient, type AgentClientModel } from './client/model.js';
import { initialState, type Action } from './state.js';
import type { ClientFrame } from './types.js';

// The retry schedule's rules live with the socket machine; re-exported here
// because the pure-function tests import it from this module's path.
export { nextRetry, RETRY_MIN_MS, RETRY_MAX_MS } from './client/connection.js';

export interface AgentClient {
  state: ReturnType<typeof import('./state.js').reduce>;
  dispatch: (action: Action) => void;
  send: (frame: ClientFrame) => void;
  connection: 'connecting' | 'open' | 'closed';
  /**
   * Drop the current socket and dial again at once, skipping the backoff.
   * (The rule lives in `client/connection.ts`; the model forwards it.)
   */
  reconnect: () => void;
}

const noop = (): void => undefined;
const idleSubscribe = (_listener: () => void): (() => void) => () => undefined;

/** The pre-connection model: stable snapshots, inert gestures. */
const IDLE_MODEL: AgentClientModel = {
  getState: () => initialState,
  getConnection: () => 'connecting',
  subscribe: idleSubscribe,
  dispatch: noop,
  send: noop,
  reconnect: noop,
  dispose: noop,
};

export function useAgent(): AgentClient {
  const [client, setClient] = useState<AgentClientModel>(() => IDLE_MODEL);
  useEffect(() => {
    const model = createAgentClient();
    setClient(model);
    return () => {
      model.dispose();
      setClient(IDLE_MODEL);
    };
  }, []);

  // `getServerSnapshot` mirrors the initial snapshots: nothing renders against
  // a live socket during SSR, and the values are the store's own initials.
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  const connection = useSyncExternalStore(client.subscribe, client.getConnection, client.getConnection);

  return { state, dispatch: client.dispatch, send: client.send, connection, reconnect: client.reconnect };
}
