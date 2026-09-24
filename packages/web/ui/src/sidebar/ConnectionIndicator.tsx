/**
 * Connection feedback: one badge that reads the socket's state and, when the
 * surface can act on it, becomes the reconnect control.
 * Ported from deepseek-harness `ui-primitives/src/client/ConnectionIndicator.tsx`
 * + `ConnectionIndicator.module.css` (c) 2026 DeepSeek — MIT License.
 *
 * One deliberate deviation: the reference's caller always has a reconnect
 * action, so its indicator is always a button. In this app the socket
 * reconnects itself (client.ts, capped backoff) and no frame asks for an
 * immediate retry, so `onReconnect` is optional and the indicator renders a
 * readout when it is absent — the badge never becomes a click that has nowhere
 * to go.
 */
import { AlertIcon, CheckIcon } from '../icons.js';
import { cls } from './view.js';
import css from './ConnectionIndicator.module.css';

/** Visual state rendered by {@link ConnectionIndicator}. */
export type ConnectionIndicatorState =
  | 'disconnected'
  | 'connecting'
  | 'recovered';

/**
 * Render an inline connection-recovery control.
 * @param props.state - visible outage, retry-attempt, or recovered state; undefined renders nothing.
 * @param props.disconnectedLabel - localized outage text.
 * @param props.reconnectLabel - localized action text shown on hover or focus.
 * @param props.connectingLabel - localized retry text followed by the attempt dots.
 * @param props.recoveredLabel - localized recovery confirmation.
 * @param props.reconnectActionLabel - accessible label for the outage action.
 * @param props.restartActionLabel - accessible label for replacing an active attempt.
 * @param props.onReconnect - request an immediate reconnect attempt; without it the indicator is a readout.
 * @returns the indicator, or null when no connection feedback is active.
 */
export function ConnectionIndicator({
  state,
  disconnectedLabel,
  reconnectLabel,
  connectingLabel,
  recoveredLabel,
  reconnectActionLabel,
  restartActionLabel,
  onReconnect,
}: {
  state: ConnectionIndicatorState | undefined;
  disconnectedLabel: string;
  reconnectLabel: string;
  connectingLabel: string;
  recoveredLabel: string;
  reconnectActionLabel: string;
  restartActionLabel: string;
  onReconnect?: (() => void) | undefined;
}): JSX.Element | null {
  if (state === undefined) return null;
  const sizeLabels = (
    <>
      <span className={css.sizeLabel} aria-hidden="true">{disconnectedLabel}</span>
      <span className={css.sizeLabel} aria-hidden="true">{reconnectLabel}</span>
      <span className={css.sizeLabel} aria-hidden="true">
        {connectingLabel}<span className={css.dots}>...</span>
      </span>
      <span className={css.sizeLabel} aria-hidden="true">{recoveredLabel}</span>
    </>
  );
  if (state === 'recovered') {
    return (
      <div className={`${css.indicator} ${css.success}`} role="status" aria-label={recoveredLabel}>
        <span className={css.icon} aria-hidden="true"><CheckIcon /></span>
        <span className={css.label}>
          {sizeLabels}
          <span className={css.stateLabel}>{recoveredLabel}</span>
        </span>
      </div>
    );
  }

  const connecting = state === 'connecting';
  const stateText = connecting
    ? (
      <>
        {connectingLabel}
        <span className={css.dots} aria-hidden="true">
          <span>.</span>
          <span className={css.secondDot}>.</span>
          <span className={css.thirdDot}>.</span>
        </span>
      </>
    )
    : disconnectedLabel;
  if (onReconnect === undefined) {
    return (
      <div
        className={cls(css.indicator, css.warning, css.readout)}
        role="status"
        data-phase={state}
        aria-label={connecting ? connectingLabel : disconnectedLabel}
      >
        <span className={css.icon} aria-hidden="true"><AlertIcon /></span>
        <span className={css.label}>
          {sizeLabels}
          <span className={css.stateLabel}>{stateText}</span>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cls(css.indicator, css.warning)}
      data-phase={state}
      aria-label={connecting ? restartActionLabel : reconnectActionLabel}
      onClick={onReconnect}
    >
      <span className={css.icon} aria-hidden="true"><AlertIcon /></span>
      <span className={css.label}>
        {sizeLabels}
        <span className={css.stateLabel}>{stateText}</span>
        <span className={css.hoverLabel}>{reconnectLabel}</span>
      </span>
    </button>
  );
}