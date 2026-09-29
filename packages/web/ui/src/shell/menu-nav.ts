/**
 * Keyboard walking for a select menu, reduced from deepseek-harness
 * `ui-primitives` Menu's arrow-key navigation (c) 2026 DeepSeek — MIT License
 * to its index arithmetic, so the wrap-around behaviour is asserted without a
 * DOM (the component lane here is deliberately element-free).
 */

/** An empty menu has no focus target at all. */
const NONE = -1;

/**
 * The neighbouring option index a key press lands on.
 * @param current - the focused index, or -1 while nothing is focused.
 * @param count - how many options the menu holds.
 * @param delta - how many rows to step (negative walks up).
 * @returns the wrapped index, or -1 for an empty menu.
 */
export function stepOptionIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return NONE;
  if (current < 0 || current >= count) return delta >= 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** Whether an index points at an option (guards DOM focus walks). */
export function isOptionIndex(index: number, count: number): boolean {
  return index >= 0 && index < count;
}
