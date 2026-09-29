/**
 * The rejection contract for an inbound frame: the ONE way an untrusted client
 * message is turned away.
 *
 * Its own module because both halves of wire validation produce it — the shape
 * parser (`client-frame.ts`) and the path-rules parser (`fs-frame-parse.ts`) —
 * and neither should have to import the other to say "no".
 */

/** A frame the host refuses: the reason is meant to be logged and rendered. */
export interface FrameRejection {
  ok: false;
  reason: string;
}

/** Build a rejection — the single constructor, so `ok: false` is never assembled by hand. */
export function reject(reason: string): FrameRejection {
  return { ok: false, reason };
}
