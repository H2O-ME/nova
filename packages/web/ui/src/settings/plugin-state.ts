/**
 * The kernel's plugin states, in the reader's words.
 *
 * `WireRosterEntry.state` is the container's own `FiberState`
 * (`core/plugin/fiber.ts`: pending / loading / active / failed / disposed) —
 * a mechanical name that reaches this surface verbatim. The reference never
 * prints one: its inventory renders the same five phases through the
 * `settings.pluginInventory` dictionary, so a screenshot compares words rather
 * than internals. This is that mapping, kept apart from the row so the vitest
 * lane can check it without a DOM.
 */
import { SETTINGS_COPY } from './copy.js';
import type { StateDotState } from '../tool/StateDot.js';
import type { WireRosterEntry } from '../types.js';

/**
 * The rows that own a settings page, in roster order.
 * A row qualifies when it declares the page AND the plugin can really answer
 * one. `enabled` is the operator's intent (`absent` counts as on, the manager's
 * switch reads it the same way): a row switched off gets no section while its
 * 插件管理 row stays, which is the way back on. `state` is the liveness fact,
 * and only `active` proves a live fiber — the section exists because the
 * plugin's own `pluginRpc` namespace answers the `page` op, and that namespace
 * lives ON the fiber: `pending` / `loading` have not run `apply` yet, `failed`
 * either never got one or had its effects undone, `disposed` was torn down.
 * Offering any of them draws a section answerable only by `no loaded plugin
 * answers "…"` — a whitelist, not a `state !== 'failed'` blacklist (an unknown
 * phase proves no namespace either). `enabled` alone would keep that row's dead
 * section for good; `state` keeps it out (`web/src/roster-entry.ts`). The page
 * itself is the plugin's: this only decides WHICH sections the navigation has,
 * which is why the flags travel on the roster.
 * @param rows - the live roster rows.
 * @returns the rows whose pages the navigation should offer.
 */
export function pagePlugins(rows: readonly WireRosterEntry[]): readonly WireRosterEntry[] {
  return rows.filter(
    (row) => row.page === true && row.enabled !== false && row.state === 'active',
  );
}

/**
 * Whether a settings-page draft holds unsaved edits, compared against the
 * values the descriptor last seeded.
 *
 * The comparison runs over BOTH key sets: a field the seed removed (the plugin
 * dropped it on save) still counts while its draft value survives, and a draft
 * key the seed never had counts too. Equal content on equal keys — the common
 * mount case, a pre-filled page — is not an edit.
 * @param baseline - what the descriptor last seeded (the seed itself, not a copy).
 * @param draft - the operator's current field values.
 * @returns true when any key's values differ.
 */
export function draftDirty(
  baseline: Readonly<Record<string, string>>,
  draft: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
  for (const key of keys) {
    if (baseline[key] !== draft[key]) return true;
  }
  return false;
}

/**
 * The danger-action gate, as a pure step: what the armed id becomes after one
 * press.
 *
 * A danger action cannot be committed by its first press — the press ARMS the
 * row, and only a second press (with the armed id equal) commits. A non-danger
 * action always disarms: committing one destructive row must not be a side
 * effect of reaching for its neighbour. The renderer owns the send; this owns
 * only the decision, so the two-press rule is testable without a DOM.
 * @param armed - the id currently armed, or null.
 * @param action - the action whose button was pressed.
 * @returns the next armed id (the pressed danger action when it was not yet
 *   armed; null when the press commits or disarms).
 */
export function nextArmedDanger(
  armed: string | null,
  action: { id: string; danger?: boolean },
): string | null {
  if (action.danger !== true) return null;
  return armed === action.id ? null : action.id;
}

/** The container's `FiberState` union, as the wire reports it. */
const STATE_KEYS: Record<string, string> = {
  pending: SETTINGS_COPY['pluginState.pending'],
  loading: SETTINGS_COPY['pluginState.loading'],
  active: SETTINGS_COPY['pluginState.active'],
  failed: SETTINGS_COPY['pluginState.failed'],
  disposed: SETTINGS_COPY['pluginState.disposed'],
  // The row a switch turned off: the roster's own word for "no fiber, because
  // nobody asked for one" (`plugins/src/runtime-roster.ts`). It is a producer
  // value, not a `FiberState`, and without this entry the row printed the raw
  // wire word — 「todo · disabled · 已关闭」 was the reported reading.
  disabled: SETTINGS_COPY['pluginState.disabled'],
};

/**
 * One roster row's state label.
 *
 * `Object.hasOwn` and not a bare index: the table is an object literal, so a
 * state named `constructor` would resolve to an inherited member and render a
 * function into the row. The phase name reaches here straight off the wire.
 * @param state - the container's phase name, straight off the wire.
 * @returns the localized reading, or the wire value when this table has no word
 *   for it (a state this build does not know is still a fact worth printing).
 */
export function pluginStateLabel(state: string): string {
  return Object.hasOwn(STATE_KEYS, state) ? STATE_KEYS[state] as string : state;
}

/**
 * The same five phases as a `StateDot` semantic, for the row's leading mark.
 *
 * `failed` is `error` rather than `warning` because a plugin that did not start
 * is a missing capability, not a caution: the tools it registers do not exist.
 * `disposed` reads as `idle` for the same reason a settled loader does — there
 * is nothing in progress and nothing wrong.
 */
const DOT_STATES: Record<string, StateDotState> = {
  pending: 'idle',
  loading: 'ongoing',
  active: 'done',
  failed: 'error',
  disposed: 'idle',
};

/**
 * One row's dot semantic. Unknown phases get `idle`: an unrecognized state is a
 * host newer than this page, and drawing it as an error would report a fault
 * that was never observed.
 * @param state - the container's phase name, straight off the wire.
 * @returns the dot semantic for that phase.
 */
export function pluginStateDot(state: string): StateDotState {
  return Object.hasOwn(DOT_STATES, state) ? DOT_STATES[state] as StateDotState : 'idle';
}
