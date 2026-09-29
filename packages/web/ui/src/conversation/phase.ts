/**
 * The conversation column's three phases, ported from deepseek-harness
 * `ui-conversation` ConversationRoot (c) 2026 DeepSeek — MIT License.
 *
 * The skeleton renders the composer seat in every phase (the textarea must
 * survive a session landing) and picks the layout with `data-phase`:
 *
 *   - `hero` — nothing on screen yet: the composer stack (brand chrome +
 *     card) centers in the column and takes the hero width;
 *   - `settling` — a session exists but its history is still arriving: keep
 *     the seat mounted but invisible, so neither the centered hero nor the
 *     docked bar flashes before the phase is knowable;
 *   - `active` — a transcript is on screen: the header becomes ordinary column
 *     chrome, the seat docks sticky at the foot, the width handles appear.
 *
 * Read off state the surface already has, so the choice is asserted here
 * instead of inferred from JSX.
 */

/** Which of the three layouts the column is in. */
export type ConversationPhase = 'hero' | 'settling' | 'active';

/**
 * The transcript blocks a session carries before its first turn: the seeded
 * context fragments are pre-turn chrome (the harness logs them too, but its
 * phase reads `awaitingFirstTurn`, not a row count), so they must not keep a
 * fresh session out of the hero.
 * @param blocks - the session's blocks in order.
 * @returns true while no turn content has landed.
 */
export function awaitingFirstTurn(blocks: readonly { kind: string }[]): boolean {
  return !blocks.some((block) => block.kind !== 'context');
}

/** What the phase decision needs to know (all of it host-reported). */
export interface ConversationPhaseInput {
  /** A session is bound (the host answered `ready` for it). */
  bound: boolean;
  /** Its transcript is empty — there is nothing to read, so chrome takes the seat. */
  blank: boolean;
  /** The transcript is still arriving (a replay is in flight). */
  replaying: boolean;
}

/**
 * Resolve the column's phase.
 * @param input - see {@link ConversationPhaseInput}.
 * @returns the phase for the column's `data-phase`.
 */
export function conversationPhase(input: ConversationPhaseInput): ConversationPhase {
  if (!input.bound) return 'hero';
  if (!input.blank) return 'active';
  return input.replaying ? 'settling' : 'hero';
}