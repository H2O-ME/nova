/**
 * The approval card's decisions as pure functions: which key means which
 * answer, how the "always" grant's word scope steps and falls back, and how
 * the three answers are assembled for the wire.
 *
 * The card is a takeover, so it owns the keyboard while it is up — and every
 * rule that decides "what does this keypress send" is asserted without a DOM
 * (`test/approval-decisions.test.ts`), the same discipline `composer-keys.ts`
 * follows for the input capsule.
 *
 * Scope semantics mirror the kernel's own rules (`core/approval.ts`):
 * `ApprovalRequest.scopeWords` is present only for a bare (non-compound)
 * execute command of more than one word, the grant is a WORD PREFIX, and the
 * wire parser (`parseAskResult`, shared by the host's frame validation) refuses
 * a scope outside `1..MAX_SCOPE_WORDS` fail-closed. So the surface never offers
 * a scope the wire would reject, and a value out of range falls back to the
 * default program-prefix grant instead of being silently narrowed — what the
 * card promises the user is what the engine remembers.
 */
import type { AskResult } from '../types.js';

/**
 * Mirrors core's `MAX_ALWAYS_SCOPE_WORDS` — the cap the wire parser enforces.
 * Restated rather than imported because the browser bundle takes core TYPES
 * only (a value import would pull the server package into the frontend);
 * `test/approval-decisions.test.ts` pins the two equal.
 */
export const MAX_SCOPE_WORDS = 32;
/** Mirrors core's `MAX_DENY_REASON_CHARS` — an instruction, not a transcript. */
export const MAX_DENY_REASON_CHARS = 400;

/**
 * The highest word count an "always" grant may be pinned to for this request:
 * 0 when the request offers no scope at all (absent `scopeWords`, or a command
 * that is a single word — the default grant already IS the whole command).
 * A longer command is capped at {@link MAX_SCOPE_WORDS}.
 */
export function scopeLimit(words: readonly string[] | undefined): number {
  if (words === undefined) return 0;
  return words.length > 1 ? Math.min(words.length, MAX_SCOPE_WORDS) : 0;
}

/** Whether a scope chooser is offered at all (more than one pinnable word). */
export function isScoped(words: readonly string[] | undefined): boolean {
  return scopeLimit(words) > 0;
}

/** Clamp a word count into `1..limit`; 0 for a request with no scope. */
export function clampScope(scope: number, limit: number): number {
  if (limit <= 0) return 0;
  if (!Number.isFinite(scope)) return 1;
  return Math.min(limit, Math.max(1, Math.trunc(scope)));
}

/** Move the scope by `delta`, clamped at both ends of the offered range. */
export function stepScope(scope: number, limit: number, delta: number): number {
  return clampScope(clampScope(scope, limit) + delta, limit);
}

/**
 * The answer an "always" decision sends: the bare verdict when this request
 * offers no scope (the engine's default program prefix), the word-pinned grant
 * otherwise. The scope is always inside the wire's accepted range.
 */
export function alwaysAnswer(words: readonly string[] | undefined, scope: number): AskResult {
  const limit = scopeLimit(words);
  return limit === 0 ? 'always' : { answer: 'always', scopeWords: clampScope(scope, limit) };
}

/**
 * The answer a denial sends: the reason rides into the tool result as an
 * instruction to the model, so it is trimmed, length-capped, and dropped
 * entirely when the user typed nothing (a bare `deny` is a complete answer).
 */
export function denyAnswer(reason: string): AskResult {
  const trimmed = reason.trim().slice(0, MAX_DENY_REASON_CHARS);
  return trimmed === '' ? 'deny' : { answer: 'deny', reason: trimmed };
}

/** Everything a keydown needs to be routed (the card's own state, not the DOM). */
export interface ApprovalKeyState {
  key: string;
  /** Shift was held: in the reason field Enter then breaks the line. */
  shiftKey: boolean;
  /** The event came from the reason field: letters there are text, not answers. */
  inField: boolean;
  /** The request's pinnable words (`ApprovalRequest.scopeWords`). */
  words: readonly string[] | undefined;
  /** The word count the "always" grant currently covers. */
  scope: number;
  /** The half-typed denial reason. */
  reason: string;
}

export type ApprovalKeyAction =
  /** Send this answer for the pending request. */
  | { kind: 'answer'; answer: AskResult }
  /** Move the "always" scope (an arrow key or the stepper buttons). */
  | { kind: 'scope'; scope: number }
  /** Throw away the half-typed reason. */
  | { kind: 'clear-reason' }
  /** Not ours: let the browser have it. */
  | { kind: 'none' };

const NONE: ApprovalKeyAction = { kind: 'none' };

/**
 * Route one keydown to an action. Order is the contract:
 *
 *  1. **Inside the reason field the letters are text.** `y`/`a`/`n` are the
 *     answer keys everywhere else, but a denial reason is prose the user is
 *     writing — swallowing those keystrokes would make `n` untypable. Enter
 *     sends the denial, Shift+Enter breaks the line, and Escape clears a
 *     half-typed reason and NEVER answers (a denial is a decision with
 *     consequences, so it stays on an explicit key or click).
 *  2. **Escape elsewhere only clears the reason** — same refusal.
 *  3. **`y` allows once, `a` allows always, `n` denies** (the interactive
 *     sessions' key contract, so the same three keys mean the same three
 *     answers in the terminal and in the browser).
 *  4. **Arrows step the "always" scope**, and only when this request offers
 *     one; otherwise they are the scroll region's.
 */
export function approvalKey(state: ApprovalKeyState): ApprovalKeyAction {
  const limit = scopeLimit(state.words);
  if (state.inField) {
    if (state.key === 'Enter') {
      if (state.shiftKey) return NONE;
      return state.reason.trim() === '' ? NONE : { kind: 'answer', answer: denyAnswer(state.reason) };
    }
    if (state.key === 'Escape') return state.reason === '' ? NONE : { kind: 'clear-reason' };
    return NONE;
  }
  switch (state.key) {
    case 'y':
    case 'Y':
      return { kind: 'answer', answer: 'allow' };
    case 'a':
    case 'A':
      return { kind: 'answer', answer: alwaysAnswer(state.words, state.scope) };
    case 'n':
    case 'N':
      return { kind: 'answer', answer: denyAnswer(state.reason) };
    case 'ArrowLeft':
      return limit > 0 ? { kind: 'scope', scope: stepScope(state.scope, limit, -1) } : NONE;
    case 'ArrowRight':
      return limit > 0 ? { kind: 'scope', scope: stepScope(state.scope, limit, 1) } : NONE;
    case 'Escape':
      return state.reason === '' ? NONE : { kind: 'clear-reason' };
    default:
      return NONE;
  }
}