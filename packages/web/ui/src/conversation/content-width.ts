/**
 * The conversation column's width axis, ported from deepseek-harness
 * `ui-conversation` ConversationRoot (c) 2026 DeepSeek — MIT License.
 *
 * The skeleton resolves ONE content width W for the transcript and the dock
 * cards (the input card alone is W + 32px, both expressed in CSS); this module
 * owns the arithmetic behind it so the clamp the stylesheet applies and the
 * width a drag produces can be asserted without a DOM:
 *
 *   - the adaptive clamp (680px floor, 64% of the column, 920px cap),
 *   - the dragged preference, clamped by CONTENT_MIN and the column's edge
 *     budget so a stored width can never push its own handles off the column,
 *   - the symmetric gesture (both handles write the one centered width, so
 *     outward travel widens by 2× the pointer distance).
 *
 * Only the two durable-storage helpers at the foot touch an environment, and
 * both resolve a missing or corrupt value to "no preference" rather than
 * throwing — a browser with storage denied must still render the clamp.
 */

/** localStorage key for the dragged transcript width preference (px). */
export const WIDTH_PREF_KEY = 'nova.conversation.contentWidth';

/** Floor for a dragged content width; matches the layout center-column minimum. */
export const CONTENT_MIN = 640;

/** Column budget the content must leave free: 88px per side keeps the width
 * handles fully placeable (24px inset + 40px strip + 24px safe zone) — a
 * larger dragged width would push its own handles off the column and leave no
 * way to drag back. */
export const CONTENT_EDGE_BUDGET = 176;

/** Which strip beside the transcript a drag gesture belongs to. */
export type WidthHandleSide = 'left' | 'right';

/**
 * Resolves the content width the CSS axis would show for a column width.
 * @param columnWidth - the conversation column's rendered width in px.
 * @param preference - the dragged preference, or null for the adaptive clamp.
 * @returns the resolved content width in px (mirrors the CSS clamp).
 */
export function resolveContentWidth(columnWidth: number, preference: number | null): number {
  const max = Math.max(CONTENT_MIN, columnWidth - CONTENT_EDGE_BUDGET);
  if (preference !== null) return Math.min(Math.max(preference, CONTENT_MIN), max);
  return Math.max(680, Math.min(columnWidth * 0.64, 920));
}

/**
 * One handle gesture's width. Both sides write the one centered width, so
 * outward travel widens by 2× the pointer distance (dragging the right strip
 * inward is outward travel for the left one and vice versa).
 * @param side - which strip is being dragged.
 * @param base - the width the gesture started from (already resolved/clamped).
 * @param dx - pointer travel since the gesture started, in px.
 * @returns the unclamped width the gesture asks for.
 */
export function handleWidth(side: WidthHandleSide, base: number, dx: number): number {
  const outward = side === 'right' ? dx : -dx;
  return base + outward * 2;
}

/**
 * Reads the persisted width preference; durable-storage boundary, so a missing
 * or corrupt value resolves to "no preference".
 * @returns the stored width in px, or null when unset or invalid.
 */
export function readWidthPreference(): number | null {
  const store = durableStorage();
  if (store === null) return null;
  const raw = store.getItem(WIDTH_PREF_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Persists the width a gesture travelled to. Best effort: a browser that
 * refuses writes keeps the width for this page's lifetime only.
 * @param width - the resolved width to remember, in px.
 */
export function writeWidthPreference(width: number): void {
  const store = durableStorage();
  if (store === null) return;
  try {
    store.setItem(WIDTH_PREF_KEY, `${width}`);
  } catch {
    /* the choice simply does not survive the reload */
  }
}

/** The localStorage handle, or null where there is none to be had. */
function durableStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    /* some engines throw on the property access itself */
    return null;
  }
}