/**
 * The sidebar's foot: the settings seat and the connection readout.
 * Ported from deepseek-harness `ui-settings-general/src/client/SettingsRoot.tsx`
 * (the bottom-pinned trigger row that carries the `ConnectionIndicator`) +
 * `SettingsRoot.module.css` (c) 2026 DeepSeek — MIT License.
 *
 * The trigger opens the settings dialog, whose sections the shell (App)
 * registers — placement is not here, for the same reason the menu card's
 * wasn't: this row owns the seat, the shell owns what opens.
 *
 * The recovery window is the reference's too: a socket that heals reads as
 * 连接成功 for 2s, and only while the column is wide (the reference passes
 * undefined to the rail).
 */
import { useEffect, useRef, useState } from 'react';
import { SettingsIcon } from '../icons.js';
import { Tooltip } from '../shell/Tooltip.js';
import { ConnectionIndicator } from './ConnectionIndicator.js';
import { CONNECTING_MIN_VISIBLE_MS, RECOVERY_CONFIRMATION_MS, SIDEBAR_COPY as COPY, cls, indicatorState } from './view.js';
import type { SocketState } from './view.js';
import css from './SidebarFoot.module.css';

export interface SidebarFootProps {
  /** Rail state: 36x36 boxes, no labels, no connection readout. */
  rail: boolean;
  connection: SocketState;
  /** Request an immediate reconnect attempt from the connection indicator. */
  onReconnect?: (() => void) | undefined;
  /** Whether the settings dialog this seat opens is on screen (the echo). */
  settingsOpen: boolean;
  /** Open the settings dialog (the shell owns the panel). */
  onOpenSettings: () => void;
}

/**
 * Render the column's foot row.
 * @param props - see SidebarFootProps.
 * @returns the trigger row.
 */
export function SidebarFoot({ rail, connection, onReconnect, settingsOpen, onOpenSettings }: SidebarFootProps): JSX.Element {
  // Recovery confirmation: a reconnect that lands shows 连接成功 once, for
  // RECOVERY_CONFIRMATION_MS — the reference's own window and guard.
  const [recovered, setRecovered] = useState(false);
  // The connecting pill's minimum-visible hold (the reference's
  // CONNECTING_MIN_VISIBLE_MS): a retry that succeeds in 40ms must not flash the
  // pill for a single frame, which reads as a glitch rather than as progress.
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
    // minimum-visible hold can delay past the transition — otherwise the hold
    // would eat into the 2s the reader gets to notice 连接成功.
    if (holdConnecting) return;
    setRecovered(true);
    const timer = window.setTimeout(() => { setRecovered(false); }, RECOVERY_CONFIRMATION_MS);
    return () => { window.clearTimeout(timer); };
  }, [connection, holdConnecting]);

  const label = COPY['settings.label'];
  return (
    <div className={cls(css.triggerRow, rail && css.railRow)}>
      {/* The rail's settings seat is a bare glyph (the label is wide-only), so
          it needs a real tooltip: `title` never shows for a keyboard user, and
          the reference wraps this same trigger in its Tooltip primitive. */}
      <Tooltip label={label} side="right" delayMs={500} disabled={!rail}>
        <button
          type="button"
          className={cls(css.trigger, rail && css.rail)}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title={label}
          onClick={onOpenSettings}
        >
          <SettingsIcon className={css.triggerIcon} />
          {!rail && <span className={cls(css.triggerLabel, css.wide)}>{label}</span>}
        </button>
      </Tooltip>
      <ConnectionIndicator
        state={rail ? undefined : indicatorState(connection, recovered, holdConnecting)}
        onReconnect={onReconnect}
        disconnectedLabel={COPY['connection.error']}
        reconnectLabel={COPY['connection.retry']}
        connectingLabel={COPY['connection.connecting']}
        recoveredLabel={COPY['connection.connected']}
        reconnectActionLabel={COPY['connection.reconnect']}
        restartActionLabel={COPY['connection.restart']}
      />
    </div>
  );
}
