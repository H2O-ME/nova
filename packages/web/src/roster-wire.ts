/**
 * The kernel's roster entry → {@link WireRosterEntry}: the ONE builder.
 *
 * Split from `roster-entry.ts` (the row's shape) because two call sites assemble
 * this row from the same source, and two hand-written mappings is how they drift:
 * adding `tier` to one and forgetting the other made the plugins panel show
 * English identifiers in the tier-less "standard" group on FIRST PAINT while a
 * later flip happened to fix it — a bug visible only on the initial render.
 *
 * The parameter is structural, not the kernel's own type: the wire shape stays
 * free to outlive a rename on the assembly side, and a host that predates a field
 * simply omits it (the optionals on the row say so).
 */
import type { WireRosterEntry } from './roster-entry.js';

/** What the builder reads from one `Kernel.roster()` entry. */
export interface RosterSourceEntry {
  name: string;
  state: string;
  inject: readonly string[];
  enabled: boolean;
  origin: string;
  description?: string;
  tier?: string;
  title?: string;
  /** Why an enabled-but-unloadable extension has no fiber (see the row's field). */
  error?: string;
  /** The plugin's client bundle (boot-graph entry); absent when server-only. */
  clientBundle?: { path?: string; rev?: string };
}

/**
 * Build one wire row.
 * @param entry - one entry from `Kernel.roster()`.
 * @returns the row to put on the wire.
 */
export function toWireRosterEntry(entry: RosterSourceEntry): WireRosterEntry {
  return {
    name: entry.name,
    state: entry.state,
    inject: entry.inject,
    enabled: entry.enabled,
    origin: entry.origin,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.tier !== undefined ? { tier: entry.tier } : {}),
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {}),
    ...(entry.clientBundle !== undefined ? { clientBundle: entry.clientBundle } : {}),
  };
}
