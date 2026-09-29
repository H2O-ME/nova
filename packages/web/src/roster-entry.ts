/**
 * One `/plugins` roster row, straight across the wire.
 *
 * It mirrors the kernel's `PluginRosterEntry` without importing the plugins
 * package's type: the browser needs the fields it draws, and the wire shape must
 * stay free to outlive a rename on the assembly side. The host keeps them in step,
 * and `roster-wire.ts` is the single builder.
 */
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
}
