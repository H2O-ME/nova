/**
 * The settings panel's switches: flipping `plugins.enable` / `plugins.disable` /
 * `skills.disable` and reloading the roster in place.
 *
 * Split from `runtime-roster.ts` (what LOADS) because this is what the panel
 * CHANGES, and the readers differ — the router calls these, the boot path
 * never does. One module, one discipline: **persist first, then reload, then
 * verify** — a successful call means the file and the live roster agree, and a
 * throw means neither moved (the persister throws before anything reloads, the
 * reload throws before its result is reported).
 *
 * Reload shape mirrors the existing seams on purpose: a plugin flip re-rosters
 * exactly like `setCodeMode` does (itself a full `env.reroster()`), a skill
 * flip reloads exactly like a workspace switch does (`env.loadWorkspace()`).
 */
import { skills as skillsKey } from '@nova-agent/core';
import { CORE_PLUGINS, isCorePlugin, labelFor, pluginTier } from './plugin-tier.js';
import type { CreateKernelOptions, PluginRosterEntry } from './runtime-types.js';
import type { Environment } from './runtime-env.js';

/**
 * Plugins the manager must not offer to turn off.
 *
 * DERIVED from the tier table (`plugin-tier.ts`), never a second hand-kept list.
 * The old one drifted, and its stale `'jobs'` entry (the CAPABILITY provider's
 * name, not the TOOL plugin's) locked the model-facing `jobs` tool out of its own
 * switch. The provider was renamed `jobs-service`, and the list is now the core
 * tier itself, so the two cannot disagree. Kept under this name: public API.
 */
export const NON_DISABLABLE_PLUGINS: readonly string[] = CORE_PLUGINS;

/**
 * Every known plugin's row, loaded or not. Live rows come from the container
 * (name, fiber state, injected services); disabled plugins leave no fiber, so
 * their rows are rebuilt from the manifest (`enabled: false`, no state, no
 * injections). The manifest is refreshed on every roster, so the union is
 * always current — a name in NEITHER is unknown, not merely off.
 *
 * `tier` and `title` come from the ONE label table; `tier` is what the panel
 * groups by and what decides whether a row gets a switch at all.
 */
export function describePlugins(env: Environment): PluginRosterEntry[] {
  const live = new Map(env.root.roster().map((entry) => [entry.name, entry]));
  const rows: PluginRosterEntry[] = [];
  for (const known of env.state.manifest) {
    const fiber = live.get(known.name);
    live.delete(known.name);
    const base = {
      tier: known.tier,
      title: known.title,
      origin: known.origin,
      ...(known.description !== undefined ? { description: known.description } : {}),
    };
    if (fiber !== undefined) {
      rows.push({ name: fiber.name, state: fiber.state, inject: fiber.inject, enabled: true, ...base });
    } else {
      rows.push({
        name: known.name,
        // An enabled extension whose package could not load is FAILED, not off:
        // the panel's failed treatment (group count, sort-to-top, 失败 label)
        // is what the reader needs, with `error` saying why.
        state: known.error !== undefined ? 'failed' : 'disabled',
        inject: [],
        enabled: false,
        ...base,
        ...(known.error !== undefined ? { error: known.error } : {}),
      });
    }
  }
  // Fibers no manifest names (capability providers, the toolbox, an extra that
  // appeared without a recorded roster): still facts worth printing, grouped as
  // capabilities the manager shows but does not switch.
  for (const fiber of live.values()) {
    rows.push({
      name: fiber.name,
      state: fiber.state,
      inject: fiber.inject,
      enabled: true,
      origin: 'capability',
      tier: pluginTier(fiber.name),
      title: labelFor(fiber.name).title,
    });
  }
  return rows;
}

/**
 * Flip one plugin's switch.
 *
 * WHICH list it writes is decided by TIER, and that is the whole point of the
 * split:
 *  - `core` refuses outright (no switch is even drawn for it);
 *  - `standard` writes `plugins.disable`, because shipping ON and being turned
 *    off is what `disable` means;
 *  - `advanced` writes `plugins.enable`, because shipping OFF and being asked
 *    for is what `enable` means. Writing it to `disable` would be a one-way
 *    door: `disable` wins over `enable` in the gate, so a plugin turned off by
 *    a `disable` entry could never be turned back on by a later click that
 *    only adds `enable`. The advanced rows with a SECOND opt-in door (`ptc`
 *    via `code.mode`, `qqbot` via its config block) are the exception: they
 *    write BOTH lists in both directions — see the inline note below.
 *
 * Then it re-rosters the same way a code-mode change does, and VERIFIES the
 * live container — a roster that silently kept the old set would report success
 * while the tools still answer.
 *
 * @param env - the live environment.
 * @param opts - the assembly options (supplies the persister).
 * @param name - the plugin's roster name.
 * @param enabled - whether it should load.
 * @returns the disable list now in force (a plain `advanced` flip leaves it
 * unchanged).
 */
export async function setPluginEnabled(
  env: Environment,
  opts: CreateKernelOptions,
  name: string,
  enabled: boolean,
): Promise<readonly string[]> {
  if (isCorePlugin(name)) {
    throw new Error(`plugin "${name}" is load-bearing and cannot be turned off`);
  }
  const known = new Set(env.state.manifest.map((entry) => entry.name));
  if (!known.has(name)) {
    throw new Error(`unknown plugin "${name}" (not in this kernel's roster)`);
  }
  const persist = opts.persistConfig;
  if (persist === undefined) {
    throw new Error('this surface cannot persist plugin switches (no config writer)');
  }
  if (pluginTier(name) === 'advanced') {
    if (persist.setPluginEnabledList === undefined) {
      throw new Error(
        `this surface cannot persist plugin switches for the advanced tier (no plugins.enable writer)`,
      );
    }
    const wanted = new Set(env.state.pluginsEnable);
    if (enabled) wanted.add(name);
    else wanted.delete(name);
    const next = await persist.setPluginEnabledList([...wanted].sort());
    env.state.pluginsEnable = [...next];
    // Two advanced rows have a SECOND door onto the same fact, so deleting the
    // name from `enable` does NOT turn them off — the derivation puts it
    // straight back, and the verify step below throws "still loaded after
    // disabling": a switch that errors instead of working, i.e. a one-way door —
    // the exact defect this task exists to fix.
    //
    //  - `ptc`: a `code.mode` other than `native` is itself an explicit opt-in,
    //    which the roster translates into an `enable` entry (`codeModeOptIn`).
    //  - `qqbot`: a `qqbot` block in the config is itself an opted-in channel,
    //    which boot (`kernel-config.ts`) translates into an `enable` entry —
    //    so a close that only removed the derived entry left NO trace in the
    //    file, and the next boot flipped the switch back on by itself.
    //
    // So such a row is ALSO kept in `disable`, which WINS over the derived
    // `enable` (same order `enabledByTier` applies). That makes the flip
    // effective now AND durable across a restart, where the file's own opt-in
    // hint would otherwise re-enable it. Both directions write, or the
    // leftover entry becomes the same door facing the other way (off forever).
    // `codeMode` follows a `ptc` flip so the page's two doors onto PTC cannot
    // disagree; on the way ON a `native` mode becomes `both`, matching
    // `runtime-builtins.ts` so state and loaded plugin agree.
    if (name === 'ptc' || name === 'qqbot') {
      const disable = await persist.setPluginEnabled(name, enabled);
      env.state.pluginsDisable = [...disable];
      if (name === 'ptc') {
        env.state.codeMode = enabled
          ? (env.state.codeMode === 'native' ? 'both' : env.state.codeMode)
          : 'native';
      }
    }
  } else {
    const disable = await persist.setPluginEnabled(name, enabled);
    // The roster reads the MUTABLE state, not the boot config — keep the two in
    // step, or the next workspace switch would undo this flip from the stale
    // boot list.
    env.state.pluginsDisable = [...disable];
  }
  await env.reroster();
  const live = new Set(env.root.roster().map((entry) => entry.name));
  if (!enabled && live.has(name)) {
    throw new Error(`plugin "${name}" is still loaded after disabling`);
  }
  if (enabled && !live.has(name)) {
    throw new Error(`plugin "${name}" did not load after enabling`);
  }
  return env.state.pluginsDisable;
}

/**
 * Flip one skill's switch. Persists `skills.disable`, then reloads the skill
 * index the same way a workspace switch does — the `<available_skills>` block
 * and the `skill` tool both read that list, so one reload governs both doors.
 * A reloaded index also refreshes the `skills` provider, whose `all()` reads
 * the same state. Returns the disable list now in force.
 */
export async function setSkillEnabled(
  env: Environment,
  opts: CreateKernelOptions,
  name: string,
  enabled: boolean,
): Promise<readonly string[]> {
  const persist = opts.persistConfig;
  if (persist === undefined) {
    throw new Error('this surface cannot persist skill switches (no config writer)');
  }
  // Checked against the UNFILTERED discovery (`loadWorkspace` applies the
  // current disable list, so call it with the name temporarily allowed): the
  // skill being flipped must be discoverable right now, or the name is a typo.
  // A typo would otherwise write a disable entry that can never be read back
  // as a row — the same fail-loud discipline as `plugins.disable`'s boot
  // warning, enforced here instead of warned because the panel is interactive
  // and can say so.
  const previous = env.state.skillsDisable;
  env.state.skillsDisable = previous.filter((entry) => entry !== name);
  let names: Set<string>;
  try {
    names = new Set((await env.loadWorkspace()).map((skill) => skill.name));
  } finally {
    env.state.skillsDisable = previous;
    await env.loadWorkspace();
  }
  if (!names.has(name)) {
    throw new Error(`unknown skill "${name}" (no SKILL.md with that name in project or user roots)`);
  }
  const disable = await persist.setSkillEnabled(name, enabled);
  env.state.skillsDisable = [...disable];
  await env.loadWorkspace();
  await env.root.must(skillsKey).reload();
  return disable;
}
