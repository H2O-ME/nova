/**
 * Which of the CANDIDATES actually load: the one gate between "this plugin
 * exists for this build" and "this plugin is in force".
 *
 * Split from `roster.ts` because the two answer different questions. `roster.ts`
 * answers "how does a config document become a list of plugin objects" (it
 * loads modules off disk and reasons about file paths); this answers "may this
 * named plugin run right now" (a pure name lookup over the tier table and the
 * operator's two lists). The second is the question the settings panel asks on
 * every flip, so it must be callable with no I/O and no container.
 *
 * The rule itself lives in `plugin-tier.ts`'s `enabledByTier` — ONE function,
 * so `plugins.disable`'s boot warning, the roster, and the panel's switch all
 * reach the same verdict. This module is only the roster-shaped adapter over
 * it, plus the typo surface that makes a misspelled name loud.
 */
import { enabledByTier } from './plugin-tier.js';
import { pluginName, type Plugin } from '@nova-agent/core';

/**
 * The name a candidate is gated under. `name` is optional in core's protocol
 * (the container resolves a missing one lazily), so it is resolved here with
 * core's own rule rather than assumed: a nameless function plugin still gets a
 * stable identity — its own function name — instead of becoming `undefined`.
 */
function rosterName(plugin: Plugin): string {
  return pluginName(plugin, 'anonymous');
}

/** The two operator lists in force, already merged with the live panel state. */
export interface RosterLists {
  /** Names asked for against their tier default (`plugins.enable`). */
  enable?: readonly string[] | undefined;
  /** Names turned off (`plugins.disable`). Wins over `enable`. */
  disable?: readonly string[] | undefined;
}

/**
 * Names the operator listed but nothing provides — a typo, not a no-op.
 *
 * `alsoKnown` covers names that are known without being candidates: the
 * EXTENSION plugins load from their own packages only when enabled, so their
 * names never appear among the candidates passed here — yet a `plugins.disable`
 * entry naming one is correct, not a typo.
 */
export function unknownDisabled(
  plugins: readonly Plugin[],
  disable?: readonly string[],
  alsoKnown: readonly string[] = [],
): string[] {
  if (disable === undefined) return [];
  const known = new Set([...plugins.map(rosterName), ...alsoKnown]);
  return disable.filter((name) => !known.has(name));
}

/**
 * The plugins from `candidates` that should load, in the order given.
 *
 * Every source goes through here — built-ins, the surface's own plugins, and
 * `plugins.extra` alike. That last one is the point: it used to be spread into
 * the host raw, so a third-party module was never filtered and its switch threw
 * when clicked. A plugin the operator cannot turn off is not a plugin, it is a
 * hard-coded feature wearing a plugin's name.
 * @param candidates - every plugin this build/unload could load, in load order.
 * @param lists - the operator's two lists, merged with live panel state.
 * @returns the subset that is in force.
 */
export function loadableRoster(candidates: readonly Plugin[], lists: RosterLists): Plugin[] {
  return candidates.filter((plugin) => enabledByTier(rosterName(plugin), lists));
}
