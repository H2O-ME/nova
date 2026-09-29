/**
 * Who owns the last management refusal?
 *
 * The channel is shared: every managed section's rejection lands in the same
 * `state.manageError`, because a per-section error field would let two panels
 * disagree about which one failed. That is right for the reducer and awkward for
 * the page — the settings dialog mounts ONE section at a time
 * (`SettingsPanel`'s `active?.content`), so a stale refusal left over from the
 * plugins page would be drawn again by the qqbot page, attributing someone
 * else's failure to the wrong controls.
 *
 * `manageError.seq` alone cannot answer this: it is assigned by the reducer when
 * the frame lands, so a section never knows the number in advance. But it does
 * not need to — a section only needs to know whether it had a write IN FLIGHT
 * when that refusal arrived. `begin()` marks the send, `settle()` marks this
 * section's own success, and a refusal that lands in between is ours.
 *
 * A refusal is also the end of the wait: the control must be released, which is
 * why `settle()` clears the flag on the success path and the hook clears it when
 * a refusal arrives.
 */
import { useEffect, useRef, useState } from 'react';

/** The refusal channel as the reducer stores it. */
export interface ManageErrorValue {
  readonly seq: number;
  readonly message: string;
}

/**
 * The sentence a section should show for the current refusal.
 *
 * Pure, and exported for exactly that reason: "only if we were waiting" IS the
 * fix — the whole content of the change is this one condition — and a pure
 * function can be pinned without a browser. The static render lane cannot reach
 * it otherwise, because `waiting` is set by a click and no effect runs during
 * `renderToStaticMarkup`.
 *
 * @param waiting - whether this section had a write in flight.
 * @param manageError - the shared refusal channel.
 * @returns the message to render, or null when the refusal was not ours.
 */
export function refusalToShow(
  waiting: boolean,
  manageError: ManageErrorValue | null,
): string | null {
  if (!waiting || manageError === null) return null;
  return manageError.message;
}

export interface ManageRefusal {
  /** The sentence to show, or null when the last refusal was not ours. */
  message: string | null;
  /** Call immediately before sending a write. */
  begin: () => void;
  /** Call when this section's own success answer lands. */
  settle: () => void;
}

/**
 * Attribute the shared refusal channel to this section's own writes.
 * @param manageError - the reducer's last refusal, or null.
 * @returns the sentence to render plus the send/settle markers.
 */
export function useManageRefusal(manageError: ManageErrorValue | null): ManageRefusal {
  // A ref, not state: `waiting` is written by a click handler and read inside the
  // effect, so making it reactive would add a render that nothing observes.
  const waiting = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // Every new refusal ends the wait, whether or not it was ours: leaving the
    // flag set would let a LATER unrelated refusal be blamed on this section.
    const next = refusalToShow(waiting.current, manageError);
    waiting.current = false;
    if (next !== null) setMessage(next);
  }, [manageError]);

  return {
    message,
    begin: () => {
      waiting.current = true;
      setMessage(null);
    },
    settle: () => {
      waiting.current = false;
      setMessage(null);
    },
  };
}
