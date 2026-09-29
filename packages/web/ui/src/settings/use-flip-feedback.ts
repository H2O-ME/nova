/**
 * The one piece of state a managed section needs to run a switch: which row is
 * in flight, what the last landed flip did, and whether the host refused it.
 *
 * Two sections (插件管理 / Skill 中心) need the same lifecycle, and copying it is
 * how they drifted apart in the first place — the refusal half was remembered in
 * one place and forgotten in another, which is exactly the reported defect. So
 * the lifecycle lives here once:
 *
 *  1. `begin(name, enabled)` before the frame goes out — marks the row in flight
 *     and claims the next refusal as this section's;
 *  2. `settle()` when the host's own snapshot lands — releases the row and
 *     returns the sentence to show, built from the row the flip named;
 *  3. a refusal instead sets `error` (via `useManageRefusal`) and leaves no
 *     success sentence, so a declined write never reads as one that worked.
 *
 * The sentence uses the row's own display name, so the confirmation and the row
 * agree without the reader resolving an identifier.
 */
import { useRef, useState } from 'react';
import { SETTINGS_COPY } from './copy.js';
import { useManageRefusal, type ManageErrorValue } from './use-manage-refusal.js';

/** The flip this section is waiting on. */
export interface PendingFlip {
  readonly name: string;
  readonly enabled: boolean;
}

export interface FlipFeedback {
  /** The row currently in flight, or null. */
  switching: string | null;
  /** What the last landed flip did, in words, or null. */
  applied: string | null;
  /** The host's refusal sentence, or null. */
  error: string | null;
  /** Call before sending a flip. */
  begin: (name: string, enabled: boolean) => void;
  /**
   * Call when the section's own success snapshot lands.
   * @param titleOf - the display name for the row the pending flip named.
   */
  settle: (titleOf: (flip: PendingFlip) => string) => void;
}

/**
 * Run the flip lifecycle.
 * @param manageError - the shared refusal channel from the reducer.
 * @returns the feedback state plus its two markers.
 */
export function useFlipFeedback(manageError: ManageErrorValue | null): FlipFeedback {
  const [switching, setSwitching] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const pending = useRef<PendingFlip | null>(null);
  const refusal = useManageRefusal(manageError);

  const begin = (name: string, enabled: boolean): void => {
    setSwitching(name);
    setApplied(null);
    pending.current = { name, enabled };
    refusal.begin();
  };

  const settle = (titleOf: (flip: PendingFlip) => string): void => {
    setSwitching(null);
    refusal.settle();
    const done = pending.current;
    pending.current = null;
    if (done === null) return;
    const title = titleOf(done);
    setApplied(
      done.enabled
        ? SETTINGS_COPY['plugins.appliedOn'].replace('{name}', title)
        : SETTINGS_COPY['plugins.appliedOff'].replace('{name}', title),
    );
  };

  return { switching, applied, error: refusal.message, begin, settle };
}

/** The refusal channel's shape, re-exported so a section imports one module. */
export type { ManageErrorValue } from './use-manage-refusal.js';

/**
 * Build "the display name of the row this flip named" over a snapshot's entries.
 * A row that vanished between the click and the answer falls back to its id.
 * @param entries - the snapshot's rows.
 * @param titleOf - how to read one row's display name.
 * @returns the lookup the feedback hook's `settle` takes.
 */
export function titleLookup<T extends { name: string }>(
  entries: readonly T[],
  titleOf: (entry: T) => string,
): (flip: PendingFlip) => string {
  return (flip) => {
    const row = entries.find((entry) => entry.name === flip.name);
    return row === undefined ? flip.name : titleOf(row);
  };
}
