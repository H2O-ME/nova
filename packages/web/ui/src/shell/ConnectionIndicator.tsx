/**
 * Connection feedback: one badge that reads the socket's state and, when the
 * surface can act on it, becomes the reconnect control.
 * Ported from deepseek-harness `ui-primitives/src/client/ConnectionIndicator.tsx`
 * + `ConnectionIndicator.module.css` (c) 2026 DeepSeek — MIT License.
 *
 * One deliberate deviation: the reference's caller always has a reconnect
 * action, so its indicator is always a button. Here `onReconnect` is passed by
 * the shell (App → the header's status seat) and the socket also reconnects
 * itself (client.ts, capped backoff), so the prop is optional and the indicator
 * degrades to a readout when a caller omits it — the badge then never becomes a
 * click that has nowhere to go.
 */
import { useEffect, useState } from 'react';
import { AlertIcon, CheckIcon } from '../icons.js';
import { StateDot } from '../tool/StateDot.js';
import { cx } from '../composer/cx.js';
import { indicatorTransition, type ConnectionIndicatorState } from './connection.js';
import css from './ConnectionIndicator.module.css';

/**
 * Exit-transition length; keep equal to the `.leaving` transition duration in
 * the stylesheet (the reference's `EXIT_MS`).
 */
const EXIT_MS = 150;

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
  // The badge fades out instead of vanishing. `state` going undefined is the
  // signal to leave, so the last rendered state is kept until the fade ends —
  // without this the pill disappears in the same frame the socket recovers,
  // which reads as the badge being yanked rather than as the outage ending. The
  // rule itself is pure (`indicatorTransition`); this only owns the timer.
  const [rendered, setRendered] = useState(state);
  const step = indicatorTransition(rendered, state);
  const leaving = step.leaving;
  useEffect(() => {
    if (state !== undefined) {
      setRendered(state);
      return;
    }
    if (rendered === undefined) return;
    const timer = window.setTimeout(() => { setRendered(undefined); }, EXIT_MS);
    return () => { window.clearTimeout(timer); };
  }, [state, rendered]);

  if (step.rendered === undefined) return null;
  const view = step.rendered;
  const leavingClass = leaving ? ` ${css.leaving}` : '';
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
  if (view === 'recovered') {
    return (
      <div className={`${css.indicator} ${css.success}${leavingClass}`} role="status" aria-label={recoveredLabel}>
        <span className={css.icon} aria-hidden="true"><CheckIcon /></span>
        <span className={css.label}>
          {sizeLabels}
          <span className={css.stateLabel}>{recoveredLabel}</span>
        </span>
      </div>
    );
  }

  const connecting = view === 'connecting';
  // The reference swaps the leading glyph with the phase: a live retry shows the
  // ongoing spinner (the same ring the tool rows use), while a plain outage shows
  // the alert. A static warning triangle during a retry reads as "broken", which
  // is the opposite of what an in-flight attempt is reporting.
  const glyph = connecting ? <StateDot state="ongoing" /> : <AlertIcon />;
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
        className={cx(css.indicator, css.warning, css.readout) + leavingClass}
        role="status"
        data-phase={view}
        aria-label={connecting ? connectingLabel : disconnectedLabel}
      >
        <span className={css.icon} aria-hidden="true">{glyph}</span>
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
      className={`${cx(css.indicator, css.warning)}${leavingClass}`}
      data-phase={view}
      aria-label={connecting ? restartActionLabel : reconnectActionLabel}
      onClick={onReconnect}
    >
      <span className={css.icon} aria-hidden="true">{glyph}</span>
      <span className={css.label}>
        {sizeLabels}
        <span className={css.stateLabel}>{stateText}</span>
        <span className={css.hoverLabel}>{reconnectLabel}</span>
      </span>
    </button>
  );
}