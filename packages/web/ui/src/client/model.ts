/**
 * The client model: ONE owner for the browser's state, with no React in it.
 *
 * It pairs the reducer (`../state.ts` — frames in, state out, pure) with the
 * connection (`./connection.ts` — socket life cycle) and exposes the pair as a
 * subscribable store. React is a thin consumer (`../client.ts`): it reads
 * snapshots and forwards callbacks, nothing more. The same model could drive a
 * non-React surface, and the reconnection/dispatch rules are assertable by
 * calling the store directly.
 */
import { reduce, initialState, type Action, type UiState } from '../state.js';
import type { ClientFrame } from '../types.js';
import { createConnection, type Connection, type ConnectionStatus } from './connection.js';
import { frameAction } from './protocol.js';
import { clearFrameSender, deliverServerFrame, dropPendingRequests, setFrameSender } from './requests.js';

export interface AgentClientModel {
  /** The current reducer state (a stable reference until a dispatch changes it). */
  getState: () => UiState;
  /** The current dialing status (a stable string until a status callback). */
  getConnection: () => ConnectionStatus;
  /** Subscribe to ANY change (state or connection); returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  /** Forward a reducer action (the shell's own state gestures). */
  dispatch: (action: Action) => void;
  /**
   * Send one frame to the host. The reducer's `sent` bookkeeping fires only
   * when the frame actually left — request-side state and its replies live in
   * the same reducer, one owner for client state.
   */
  send: (frame: ClientFrame) => void;
  /** Drop the socket and dial again at once (the indicator's 重试). */
  reconnect: () => void;
  /** Tear down for good (the hook's unmount). */
  dispose: () => void;
}

export function createAgentClient(): AgentClientModel {
  let state: UiState = initialState;
  let connection: ConnectionStatus = 'connecting';
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const dispatch = (action: Action): void => {
    state = reduce(state, action);
    emit();
  };

  const conn: Connection = createConnection({
    onFrame: (frame) => {
      // 请求-响应枢纽先认领（见 requests.ts）：`image_uploaded` 等回帧的等待
      // 者在这里拿走答案，剩下的帧才进 reducer 的路由表。
      if (deliverServerFrame(frame)) return;
      const action = frameAction(frame as Parameters<typeof frameAction>[0]);
      if (action !== null) dispatch(action);
    },
    onStatus: (status) => {
      connection = status;
      // The reducer's `connected` gates every control: a dropped socket must
      // dark them all, not leave buttons that silently do nothing. A newly
      // OPEN socket dispatches nothing — `connected` is lit by the `ready`
      // reduction alone (see connection.ts).
      if (status === 'closed') {
        dispatch({ type: 'connection', connected: false });
        // 在飞的帧请求跟着断线一起作废：等待者立刻降级，而不是干等超时。
        dropPendingRequests();
      }
      emit();
    },
  });
  // 把发送路径交给 requests.ts：模块级的帧调用点（图片、dashboard 等）不持有
  // model 实例，经由这里拿到当前连接的发送能力。
  const forward = (frame: unknown): boolean => conn.send(frame);
  setFrameSender(forward);

  return {
    getState: () => state,
    getConnection: () => connection,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    send: (frame) => {
      if (!conn.send(frame)) return;
      dispatch({ type: 'sent', frame });
    },
    reconnect: () => {
      conn.reconnect();
    },
    dispose: () => {
      conn.dispose();
      // 只有当前注册者才能清掉发送路径：StrictMode 卸旧装新的顺序保证清理
      // 不会误伤后继连接。
      clearFrameSender(forward);
      dropPendingRequests();
      listeners.clear();
    },
  };
}
