/**
 * The connection readout the session header carries: the badge that reads the
 * socket and, on an outage, becomes the reconnect control.
 *
 * The timing rules are the reference's (`ui-settings-general`): a healed socket
 * shows 连接成功 for a 2s confirmation, and a fast retry holds the connecting
 * pill for its 800ms minimum so it never flashes for one frame. The pure
 * decisions live in `connection.ts`; this component only owns the timers.
 */
import { useEffect, useRef, useState } from 'react';
import { ConnectionIndicator } from './ConnectionIndicator.js';
import {
  CONNECTING_MIN_VISIBLE_MS,
  indicatorState,
  RECOVERY_CONFIRMATION_MS,
  type ConnectionIndicatorState,
  type SocketState,
} from './connection.js';
import { SHELL_COPY } from './copy.js';

export interface ConnectionBadgeProps {
  connection: SocketState;
  /** Request an immediate reconnect attempt from the badge. */
  onReconnect: () => void;
}

/**
 * Render the header's connection badge.
 * @param props - see ConnectionBadgeProps.
 * @returns the badge, or null while the socket is quietly healthy.
 */
export function ConnectionBadge({ connection, onReconnect }: ConnectionBadgeProps): JSX.Element | null {
  // Recovery confirmation: a reconnect that lands shows 连接成功 once.
  const [recovered, setRecovered] = useState(false);
  // The connecting pill's minimum-visible hold: a retry that succeeds in 40ms
  // must not flash the pill for a single frame.
  const [holdConnecting, setHoldConnecting] = useState(false);
  const connectingShownAt = useRef<number | undefined>(undefined);
  const previousConnection = useRef(connection);

  useEffect(() => {
    if (connection === 'connecting') {
      connectingShownAt.current = Date.now();
      return;
    }
    const shownAt = connectingShownAt.current;
    if (shownAt === undefined) return;
    connectingShownAt.current = undefined;
    const remaining = CONNECTING_MIN_VISIBLE_MS - (Date.now() - shownAt);
    if (remaining <= 0) return;
    setHoldConnecting(true);
    const timer = window.setTimeout(() => { setHoldConnecting(false); }, remaining);
    return () => {
      window.clearTimeout(timer);
      setHoldConnecting(false);
    };
  }, [connection]);

  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = connection;
    if (connection !== 'open') {
      setRecovered(false);
      return;
    }
    if (previous !== 'closed' && previous !== 'connecting') return;
    // The confirmation window starts when the pill becomes VISIBLE, which the
    // minimum-visible hold can delay past the transition.
    if (holdConnecting) return;
    setRecovered(true);
    const timer = window.setTimeout(() => { setRecovered(false); }, RECOVERY_CONFIRMATION_MS);
    return () => { window.clearTimeout(timer); };
  }, [connection, holdConnecting]);

  const state: ConnectionIndicatorState | undefined = indicatorState(connection, recovered, holdConnecting);
  return (
    <ConnectionIndicator
      state={state}
      onReconnect={onReconnect}
      disconnectedLabel={SHELL_COPY['connection.error']}
      reconnectLabel={SHELL_COPY['connection.retry']}
      connectingLabel={SHELL_COPY['connection.connecting']}
      recoveredLabel={SHELL_COPY['connection.connected']}
      reconnectActionLabel={SHELL_COPY['connection.reconnect']}
      restartActionLabel={SHELL_COPY['connection.restart']}
    />
  );
}
