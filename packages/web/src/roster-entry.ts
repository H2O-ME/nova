/**
 * One `/plugins` roster row, straight across the wire.
 *
 * It mirrors the kernel's `PluginRosterEntry` without importing the plugins
 * package's type: the browser needs the fields it draws, and the wire shape must
 * stay free to outlive a rename on the assembly side. The host keeps them in step,
 * and `roster-wire.ts` is the single builder.
 *
 * The one exception to "mirror, don't import": the bundle leaf (see
 * `clientBundle`) is core's declared `PluginClientBundle`, because that shape
 * has SIDE-INSENSITIVE semantics — a field renamed in a mirror still compiles,
 * and the browser reader would then read `undefined` instead of failing.
 */
import type { PluginClientBundle } from '@nova-agent/core';
export interface WireRosterEntry {
  name: string;
  state: string;
  inject: readonly string[];
  /**
   * Whether the plugin is currently loaded. Absent on old hosts — the panel
   * treats a missing flag as "loaded" (the only row kind old hosts send).
   */
  enabled?: boolean;
  /**
   * Where the plugin came from (`builtin` / `surface` / `extra` /
   * `capability`). Absent on old hosts — the panel groups such rows under the
   * system group rather than dropping them.
   */
  origin?: string;
  /** The plugin's own one-line description, when it declares one. */
  description?: string;
  /**
   * The plugin's capability tier (`core` / `standard` / `advanced`). Absent on
   * old hosts — the panel then groups by `origin` as it did before tiers existed,
   * rather than dumping every row into one bucket.
   */
  tier?: string;
  /**
   * The localized display name for the plugin kind. Absent on old hosts, in which
   * case the panel shows the plugin's own `name` (which is an identifier, not
   * prose — that is exactly what the localization adds).
   */
  title?: string;
  /**
   * Why an ENABLED extension is not usable. TWO shapes carry it: a module that
   * never loaded (no fiber) reads `state: 'failed'` with `enabled: false`, while
   * a module whose `apply()` threw reads `state: 'failed'` with `enabled: true`.
   * `enabled` therefore stays the FACT of what the operator asked for in both —
   * "I opened it and it is broken" must not read as "it is off" — so anything
   * asking whether the plugin is USABLE reads `state`: the settings navigation
   * drops every page row that is not `active` (`web/ui/src/settings/plugin-state.ts`).
   * Absent on old hosts — nothing to show, nothing to say.
   */
  error?: string;
  /**
   * Whether this plugin answers a settings `page` operation, as its own manifest
   * declares.
   *
   * The settings navigation is derived from this: a plugin that ships a page
   * gets a section without the host, the wire or the browser naming it, and a
   * plugin that is switched off keeps its row (so the page reappears when it is
   * switched back on) with no section.
   */
  page?: boolean;
  /**
   * The plugin's BROWSER-side bundle, when it ships one. The boot-graph loader
   * fetches `/plugins/<name>/<path>` and registers what it exports; `rev`
   * busts the loader's per-entry memo on a rebuild. Absent on hosts/plugins
   * without a client bundle — the loader skips the row.
   */
  clientBundle?: PluginClientBundle;
}
