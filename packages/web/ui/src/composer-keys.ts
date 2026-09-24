/**
 * The composer's key contract, ported from the harness composer keymap
 * (`ui-conversation/src/client/input/editor/keymap.ts`, MIT): one pure
 * function so the rules that decide "send / newline / close" can be asserted
 * without a DOM — a plain `<textarea>` has no editor command registry to
 * register them on, so they live here and the component only routes.
 *
 * The decision order is the harness's, step for step, and each step exists
 * because of a real failure:
 *  1. **Shift+Enter breaks the line unconditionally** — decided before the IME
 *     guard, so a composition-closing Shift+Enter still inserts the newline the
 *     user asked for.
 *  2. **A composing keydown is never ours.** Enter picks an IME candidate,
 *     Escape cancels one, arrows navigate the candidate list. `isComposing` is
 *     missing on some engines that still report the legacy keyCode 229, and
 *     Safari fires the closing keydown a tick AFTER `compositionend` — both
 *     covered by the same predicate.
 *  3. **Escape's first layer closes an open overlay** (the `@`/`/` menu).
 *     With none open the composer does NOT claim Escape: the harness has no
 *     abort chord — interrupting is the Stop seat's job (see `primarySeat`),
 *     the same gesture the button carries on every surface.
 *  4. **A held Enter is swallowed, not turned into newlines** (`event.repeat`):
 *     the harness preventDefaults before this check, so a key held down neither
 *     machine-guns sends nor rains line breaks into the draft.
 *  5. **A locked or busy bar refuses the gesture** (`canSubmit`), and consumes
 *     the key: an Enter onto a locked composer must not insert a newline the
 *     user cannot see the effect of.
 *
 * Not part of the contract yet: the harness's Cmd/Ctrl-accelerated Enter, which
 * picks the OTHER delivery mode of a busy Enter (steer instead of queue). Our
 * kernel's queued prompts are a plain ledger with no steer transport, so one
 * gesture has exactly one behaviour and the chord would decide nothing.
 */
export const COMPOSING_GRACE_MS = 10;

export interface ComposerKeyEvent {
  key: string;
  shiftKey: boolean;
  /** Legacy IME signal: engines emit keyCode 229 without `isComposing`. */
  keyCode?: number;
  isComposing?: boolean;
  repeat: boolean;
  /** A `compositionend` happened within `COMPOSING_GRACE_MS` (Safari's late keydown). */
  recentlyComposing?: boolean;
  /** The trigger menu (or any popup the bar owns) is open: Escape's first layer. */
  overlayOpen?: boolean;
  /** The bar accepts a submission (not locked, not machine-busy). */
  canSubmit?: boolean;
}

export type ComposerKeyAction =
  /** Let the browser do its thing (native newline, IME candidate handling). */
  | 'default'
  /** Submit the draft (if there is one). */
  | 'submit'
  /** Close the open overlay. */
  | 'dismiss'
  /** Own the key and do nothing with it (held Enter, locked bar). */
  | 'consume';

export function composerKey(event: ComposerKeyEvent): ComposerKeyAction {
  if (event.key === 'Enter' && event.shiftKey) return 'default';
  if (composing(event)) return 'default';
  if (event.key === 'Escape') return event.overlayOpen === true ? 'dismiss' : 'default';
  if (event.key !== 'Enter') return 'default';
  if (event.repeat) return 'consume';
  if (event.canSubmit === false) return 'consume';
  return 'submit';
}

/** Composition state a keydown can trust, including the after-end grace window. */
export function composing(event: ComposerKeyEvent): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.recentlyComposing === true;
}