/**
 * The plugin manager's view model: one roster snapshot in, the three tier groups
 * the page draws out. Pure, DOM-free, and the place the panel's rules live so
 * the vitest lane can pin them without a browser.
 *
 * Three rules, all of which the page depends on and none of which is obvious:
 *
 *  1. **Grouping is by TIER**, not by origin. Origin answers "who shipped this?"
 *     (our build / the surface / a third-party module) and that is a fact about
 *     provenance; tier answers "is this load-bearing, optional, or opt-in" and
 *     that is the question a reader of a settings page is actually asking. The
 *     panel used to group by origin, which is why `subagent` — an opt-in
 *     capability — read as a system plugin.
 *  2. **A `core` row never gets a switch**, and the check is the TIER, not a
 *     second hard-coded name list: two lists drift, and when they did, the
 *     `jobs` TOOL row rendered a switch that threw every time it was clicked.
 *  3. **Failed rows come first**, with a count. A plugin that failed to start is
 *     the one thing on this page that needs acting on, and it is otherwise easy
 *     to bury under twenty healthy rows.
 */
import type { WireRosterEntry } from '../types.js';

/** One group as the page renders it. */
export interface PluginRowGroup {
  /** `core` / `standard` / `advanced` — the tier these rows belong to. */
  tier: 'core' | 'standard' | 'advanced';
  rows: readonly WireRosterEntry[];
  /** Whether every row in the group gets a switch (`core` is the one that does not). */
  switchable: boolean;
}

/** The tiers in the order the page stacks them: load-bearing first. */
export const TIER_ORDER = ['core', 'standard', 'advanced'] as const;

/**
 * One row's tier. An old host that does not send `tier` is treated as
 * `standard`: that is the fail-open side (the row stays switchable), and it is
 * the honest reading — a host that predates tiers knows nothing about a row
 * being load-bearing, so refusing to let the operator touch it would be this
 * page inventing a lock the kernel does not have.
 * @param entry - the wire row.
 * @returns the row's tier.
 */
export function rowTier(entry: WireRosterEntry): 'core' | 'standard' | 'advanced' {
  return entry.tier === 'core' || entry.tier === 'advanced' ? entry.tier : 'standard';
}

/** One row's display name: the Chinese title when the host sent one, else the id. */
export function rowTitle(entry: WireRosterEntry): string {
  return entry.title !== undefined && entry.title.length > 0 ? entry.title : entry.name;
}

/**
 * Whether a row may be switched by this page. `core` cannot (the kernel would
 * refuse anyway — the page simply does not offer a control that throws).
 * @param entry - the wire row.
 * @returns true when the row should render a switch.
 */
export function rowSwitchable(entry: WireRosterEntry): boolean {
  return rowTier(entry) !== 'core';
}

/**
 * Does one row match the search box? Case-folded substring over the row's own
 * facts: the Chinese title, the identifier, the description, and every service
 * it injects. Matching the injected names is what makes "who provides `tools`"
 * answerable from this box; matching the title is what makes it usable in the
 * language the page is written in.
 * @param entry - the wire row.
 * @param needle - the already case-folded, trimmed query ('' matches all).
 * @returns whether the row should be shown.
 */
export function rowMatches(entry: WireRosterEntry, needle: string): boolean {
  if (needle.length === 0) return true;
  return [rowTitle(entry), entry.name, entry.description ?? '', ...entry.inject]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

/**
 * Shape the page's three groups.
 *
 * Failed rows are pulled to the FRONT of their own group rather than hoisted
 * into a group of their own: the tier is still what the group means (a failed
 * `advanced` plugin is still an advanced plugin, and moving it would make the
 * group headers lie about their contents). Order within a group is otherwise
 * the host's — the roster is already in load order, which is a meaningful one.
 * @param entries - the roster rows, in the host's order.
 * @param query - the raw search box contents.
 * @returns the groups to render, empty groups omitted.
 */
export function pluginGroups(entries: readonly WireRosterEntry[], query = ''): PluginRowGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = entries.filter((entry) => rowMatches(entry, needle));
  return TIER_ORDER.map((tier) => {
    const rows = matches.filter((entry) => rowTier(entry) === tier);
    // Stable partition: failed first, everything else in the host's order.
    const ordered = [...rows.filter((row) => row.state === 'failed'), ...rows.filter((row) => row.state !== 'failed')];
    return { tier, rows: ordered, switchable: tier !== 'core' };
  }).filter((group) => group.rows.length > 0);
}

/**
 * How many rows in this snapshot failed to start — the page's count badge.
 * @param entries - the roster rows.
 * @returns the number of rows whose fiber state is `failed`.
 */
export function failedCount(entries: readonly WireRosterEntry[]): number {
  return entries.filter((entry) => entry.state === 'failed').length;
}
