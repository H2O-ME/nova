/**
 * The roster: which plugins load into the tool host, and how config changes it.
 *
 * A rebuild (workspace switch, PTC-mode change) re-rosters onto the SAME registry
 * — `host.reset()` unloads the plugins but keeps the tool service provided — so
 * consumers and the approval gate never see the registry disappear and come
 * back. The old implementation built a fresh host and dropped the previous one
 * on the floor, leaving its tools reachable through any captured reference.
 *
 * Two lists, and the ROSTER is where they are assembled into one verdict:
 * `plugins.disable` (off, wins) and `plugins.enable` (on against the tier
 * default). Both are read from the panel's LIVE state, seeded from the boot
 * config: the manager flips them mid-process, and a flip must survive the next
 * workspace switch — reading the boot document again would undo it and would
 * make a boot-time entry impossible to clear. The verdict itself is ONE call
 * (`loadableRoster` → `enabledByTier`), applied to every source in one pass:
 * the surface's own plugins, this build's built-ins, the spec-loaded
 * extensions, and `plugins.extra` alike.
 * `extra` used to be spread into the host raw, which is why a third-party
 * module could not be switched off.
 *
 * The MANIFEST is built from every candidate, INCLUDING one whose tier is off
 * right now. That is deliberate: a disabled plugin leaves no fiber, so the
 * manifest is the only place its row can still come from — build it from the
 * loadable set instead and a turned-off plugin vanishes from the very page that
 * turns it back on (the one-way-switch bug `allSkills` already fixed for
 * skills).
 */
import {
  compaction as compactionKey,
  pluginName,
  sessions as sessionsKey,
  type Plugin,
} from '@nova-agent/core';
import { PluginHost } from './host.js';
import { kernelCommandsPlugin } from './kernel-commands.js';
import { kernelPlugins } from './runtime-builtins.js';
import { enabledByTier, impliedOptIns, labelFor, pluginTier } from './plugin-tier.js';
import { skillsPlugin } from './skills.js';
import { wrapHeadlessCompact } from './headless-compact.js';
import { loadExtraPlugins } from './roster.js';
import { loadableRoster, unknownDisabled } from './roster-filter.js';
import { extensionDescriptor, extensionNames, loadExtensions } from './extensions.js';
import { surfacePlugin } from './surface-registry.js';
import type { CreateKernelOptions, PluginDescriptor, PluginOrigin } from './runtime-types.js';
import type { Environment } from './runtime-env.js';

/** (Re)build the tool host and load the roster for the current state. */
export async function reroster(env: Environment, opts: CreateKernelOptions): Promise<void> {
  const host = env.state.host ?? new PluginHost(env.state.rootDir, env.root);
  env.state.host = host;
  await host.reset();
  // Reload docs + skills for the new root BEFORE the roster: the skills plugin
  // is part of it, and the context fragment reads the same list.
  await env.loadWorkspace();
  // The panel flips these lists mid-process (see `runtime-switch.ts`), and
  // `state.pluginsDisable` is SEEDED from the boot config (`runtime-env.ts`), so
  // the live list is the whole truth. Reading `opts.config.plugins.disable` again
  // here used to union the boot snapshot back in, which made it immortal: a plugin
  // disabled at BOOT could never be switched back on in that process — the flip
  // cleared the entry from the file and from the state, and this line re-disabled
  // it, so the enable flip threw "did not load after enabling" against a row the
  // operator had just switched on.
  const effectiveDisable = [...new Set(env.state.pluginsDisable)];
  const enable = [...new Set([...env.state.pluginsEnable, ...codeModeOptIn(env, effectiveDisable)])];
  const surfacePlugins = opts.extraPlugins ?? [];
  const builtins = kernelPlugins(env, opts);
  const extra = await loadExtraPlugins(opts.config.plugins?.extra ?? [], process.cwd());
  // The EXTENSION plugins load from their OWN packages (spec table) and only
  // when enabled: a disabled or absent extension costs nothing, and one that
  // fails to load becomes a warning + an `error` on its row instead of killing
  // boot/re-roster. `enable` already carries the derived opt-ins (`codeModeOptIn`).
  const extensionRows = extensionNames();
  const extensions = await loadExtensions(
    extensionRows.filter((name) => enabledByTier(name, { enable, disable: effectiveDisable })),
    env,
    opts,
  );
  // Configured surfaces load as ORDINARY PLUGIN ROWS into the same registry the
  // resolver reads (see `surfacePlugin`): that is what puts a surface in
  // `/plugins`, in the tier table, and under the switch, instead of leaving it
  // outside the container. The caller has already imported them (it has to, to
  // answer "which surface claims this argv"), so this wraps those same objects —
  // one import, one identity.
  const surfaceRows = opts.surfaces;
  const surfaces =
    surfaceRows === undefined
      ? []
      : surfaceRows.loaded.map((surface) => surfacePlugin(surface, surfaceRows.registry));
  const typo = unknownDisabled(
    [...builtins, ...surfacePlugins, ...extra, ...surfaces],
    effectiveDisable,
    extensionRows,
  );
  if (typo.length > 0) {
    env.root.log('warn', `plugins.disable names no known plugin: ${typo.join(', ')}`);
  }
  // The manifest: every KNOWN plugin's name + origin + tier + Chinese label.
  // Built from the CANDIDATES, not the loadable subset — see the file header.
  const extensionErrors = new Map(extensions.failed.map((failure) => [failure.name, failure.error]));
  env.state.manifest = [
    ...surfacePlugins.map((plugin) => describe(plugin, 'surface')),
    ...builtins.map((plugin) => describe(plugin, 'builtin')),
    // Every extension keeps a row whether or not it loaded: a disabled, absent
    // or failed row must stay visible on the page that switches it.
    ...extensionRows.map((name) => extensionDescriptor(name, extensionErrors.get(name))),
    ...extra.map((plugin) => describe(plugin, 'extra')),
    ...surfaces.map((plugin) => describe(plugin, 'surface')),
  ];
  const skills = env.state.skills;
  const candidates: Plugin[] = [
    ...surfacePlugins,
    ...builtins,
    ...extensions.plugins,
    ...extra,
    ...surfaces,
    // Kernel-executable commands (a surface's `/` menu reads its registry).
    kernelCommandsPlugin(env),
    ...(skills.length > 0 ? [skillsPlugin(skills)] : []),
  ];
  for (const plugin of loadableRoster(candidates, { enable, disable: effectiveDisable })) {
    host.use(plugin);
  }
  await host.activate();
  if (opts.config.autoCompactTokenLimit !== undefined && opts.perRequestCompact === true) {
    wrapHeadlessCompact(env.hooks(), {
      limit: opts.config.autoCompactTokenLimit,
      compact: (options) => env.root.must(compactionKey).run(options),
      client: env.provider,
      target: () => env.root.get(sessionsKey)?.current() ?? undefined,
      notice: (code, text) => env.root.get(sessionsKey)?.current()?.notice(code, text),
    });
  }
}

/**
 * The live PTC mode as an `enable` entry. `setCodeMode` is the settings page's
 * other door onto the SAME question the ptc row's switch asks, and a mode of
 * anything but `native` IS the operator asking for the plugin — so it is
 * translated here rather than becoming a second rule inside the gate. It yields
 * to `disable` (`impliedOptIns`): a row the operator switched off stays off even
 * while a mode they set earlier still says otherwise, which is what makes the
 * switch answer the click instead of the config.
 * @param env - the live environment.
 * @param disable - the disable list in force for this roster.
 * @returns `['ptc']` when PTC is on and not switched off, else nothing.
 */
function codeModeOptIn(env: Environment, disable: readonly string[]): string[] {
  return env.state.codeMode === 'native' ? [] : impliedOptIns(['ptc'], disable);
}

/**
 * One descriptor for the manifest. The LABEL table supplies the Chinese title
 * and description; a name the table does not know keeps its own identifier and
 * the plugin's own MODEL-facing description (see `labelFor`).
 */
function describe(plugin: Plugin, origin: PluginOrigin): PluginDescriptor {
  const name = pluginName(plugin, 'anonymous');
  const label = labelFor(name);
  const own = plugin.description;
  const description = label.description.length > 0 ? label.description : own;
  return {
    name,
    origin,
    tier: pluginTier(name),
    title: label.title,
    ...(description !== undefined && description.length > 0 ? { description } : {}),
  };
}
