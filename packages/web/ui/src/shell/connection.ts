/**
 * The socket readout's pure decisions: which state the badge shows, and how it
 * leaves the screen.
 *
 * Lifted from the deleted session sidebar's view logic (the reference's
 * `ui-settings-general` rules): a healed socket reads as 连接成功 for a
 * confirmation window, and a retry that lands fast keeps the connecting pill up
 * for its minimum-visible time — an 800ms attempt flashed for one frame reads
 * as a glitch, not as progress. The badge fades rather than vanishing; the
 * component only owns the timers that feed these functions.
 */

/** The three states of the browser's one socket (client.ts). */
export type SocketState = 'connecting' | 'open' | 'closed';

/** Visual state rendered by the connection badge. */
export type ConnectionIndicatorState = 'disconnected' | 'connecting' | 'recovered';

/** How long a healed connection keeps reading as connected before the badge
 *  retires (ui-settings-general `RECOVERY_CONFIRMATION_MS`). */
export const RECOVERY_CONFIRMATION_MS = 2_000;

/** Minimum time the connecting pill stays up once shown; a retry that lands
 *  faster than this would otherwise flash it for a frame
 *  (ui-settings-general `CONNECTING_MIN_VISIBLE_MS`). */
export const CONNECTING_MIN_VISIBLE_MS = 800;

/**
 * What the badge should be showing: an outage or a retry is always worth
 * showing, a healthy socket only while the recovery confirmation is running
 * (undefined renders nothing).
 * @param connection - the socket's state.
 * @param recovered - the recovery confirmation window is running.
 * @param holdConnecting - the connecting pill's minimum-visible hold is running.
 * @returns the state to render, or undefined for nothing.
 */
export function indicatorState(
  connection: SocketState,
  recovered: boolean,
  holdConnecting = false,
): ConnectionIndicatorState | undefined {
  if (connection === 'connecting' || holdConnecting) return 'connecting';
  if (connection === 'closed') return 'disconnected';
  return recovered ? 'recovered' : undefined;
}

/**
 * What the badge is showing, and whether it is on its way out.
 *
 * Coming back is immediate — a new outage must not wait for a stale fade.
 * @param rendered - the state currently on screen, or undefined for nothing.
 * @param target - the state the connection now calls for, or undefined for none.
 * @returns the state to draw, and whether it is fading out.
 */
export function indicatorTransition(
  rendered: ConnectionIndicatorState | undefined,
  target: ConnectionIndicatorState | undefined,
): { rendered: ConnectionIndicatorState | undefined; leaving: boolean } {
  if (target !== undefined) return { rendered: target, leaving: false };
  if (rendered === undefined) return { rendered: undefined, leaving: false };
  return { rendered, leaving: true };
}
