/**
 * The sidebar's foot, the reference's shape: an identity block on the left
 * (avatar fallback letter + the product name) and the trailing controls on the
 * right — the connection readout and the settings gear.
 *
 * Nova has no account system, so the avatar is a fallback letter and the
 * identity block's ONE real affordance is the settings dialog (which is also
 * what the gear opens — the block is the wide target, the gear the precise
 * one; a duplicated affordance is a hit-target choice, not a dead control).
 *
 * The readout only speaks when something is WRONG (an outage, a live retry):
 * the reference's foot carries no steady-state status word, and the recovery
 * 连接成功 pill retired 2026-11-14 — a foot that announces health after every
 * page load is narration, not feedback.
 */
import { useEffect, useRef, useState } from 'react';
import { SettingsIcon } from '../icons.js';
import { Tooltip } from '../shell/Tooltip.js';
import { ConnectionIndicator } from '../shell/ConnectionIndicator.js';
import { CONNECTING_MIN_VISIBLE_MS, indicatorState, type SocketState } from '../shell/connection.js';
import { SIDEBAR_COPY as COPY } from './view.js';
import css from './SidebarFoot.module.css';

export interface SidebarFootProps {
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
 * @returns the footer row.
 */
export function SidebarFoot({ connection, onReconnect, settingsOpen, onOpenSettings }: SidebarFootProps): JSX.Element {
  // The connecting pill's minimum-visible hold (the reference's
  // CONNECTING_MIN_VISIBLE_MS): a retry that succeeds in 40ms must not flash the
  // pill for a single frame, which reads as a glitch rather than as progress.
  const [holdConnecting, setHoldConnecting] = useState(false);
  const connectingShownAt = useRef<number | undefined>(undefined);

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

  const settingsLabel = COPY['settings.label'];
  const identityLabel = COPY['settings.identity'];
  return (
    <div className={css.triggerRow}>
      {/* The identity block: fallback avatar letter + product name, the settings
          dialog's big target. Its label is on screen, so it carries none of the
          tooltip stand-ins a glyph-only control would need. */}
      <button
        type="button"
        className={css.trigger}
        aria-label={identityLabel}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        title={identityLabel}
        onClick={onOpenSettings}
      >
        <span className={css.avatar} aria-hidden="true">N</span>
        <span className={css.triggerLabel}>{COPY.brand}</span>
      </button>
      {/* No steady state: `indicatorState` on (open, not-recovered) resolves to
          undefined, so a healthy socket renders nothing here — the reference's
          foot is silent when nothing is wrong. */}
      <ConnectionIndicator
        state={indicatorState(connection, false, holdConnecting)}
        onReconnect={onReconnect}
        disconnectedLabel={COPY['connection.error']}
        reconnectLabel={COPY['connection.retry']}
        connectingLabel={COPY['connection.connecting']}
        recoveredLabel={COPY['connection.connected']}
        reconnectActionLabel={COPY['connection.reconnect']}
        restartActionLabel={COPY['connection.restart']}
      />
      {/* The gear: the settings dialog's precise seat beside the identity
          block's broad one. */}
      <Tooltip label={settingsLabel} side="top" delayMs={500}>
        <button
          type="button"
          className={css.gear}
          aria-label={settingsLabel}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title={settingsLabel}
          onClick={onOpenSettings}
        >
          <SettingsIcon className={css.gearIcon} />
        </button>
      </Tooltip>
    </div>
  );
}
