/**
 * The roster: which plugins load into the tool host, and how config changes it.
 *
 * A rebuild (workspace switch, PTC-mode change) re-rosters onto the SAME registry
 * — `host.reset()` unloads the plugins but keeps the tool service provided — so
 * consumers and the approval gate never see the registry disappear and come
 * back. The old implementation built a fresh host and dropped the previous one
 * on the floor, leaving its tools reachable through any captured reference.
 *
 * What loads: the surface's own plugins, the built-ins for this build, the
 * workspace's skills plugin, and `plugins.extra` from config — minus
 * `plugins.disable`. A disabled name that matches nothing is a typo and is
 * reported; an `extra` module that fails to load fails the boot (a silently
 * ignored extension is worse than a loud one).
 */
import {
  compaction as compactionKey,
  sessions as sessionsKey,
  spill as spillKey,
  tools as toolsKey,
} from '@nova-agent/core';
import { builtinPlugins } from './builtin/index.js';
import { PluginHost } from './host.js';
import { kernelCommandsPlugin } from './kernel-commands.js';
import { skillsPlugin } from './skills.js';
import { wrapHeadlessCompact } from './headless-compact.js';
import { applyRoster, loadExtraPlugins, unknownDisabled } from './roster.js';
import type { CreateKernelOptions } from './runtime-types.js';
import type { Environment } from './runtime-env.js';
import type { Plugin } from './types.js';

/** (Re)build the tool host and load the roster for the current state. */
export async function reroster(env: Environment, opts: CreateKernelOptions): Promise<void> {
  const host = env.state.host ?? new PluginHost(env.state.rootDir, env.root);
  env.state.host = host;
  await host.reset();
  // Reload docs + skills for the new root BEFORE the roster: the skills plugin
  // is part of it, and the context fragment reads the same list.
  await env.loadWorkspace();
  const { disable = [] } = opts.config.plugins ?? {};
  const surfacePlugins = opts.extraPlugins ?? [];
  const builtins = kernelPlugins(env, opts);
  const typo = unknownDisabled([...builtins, ...surfacePlugins], disable);
  if (typo.length > 0) {
    env.root.log('warn', `plugins.disable names no known plugin: ${typo.join(', ')}`);
  }
  const extra = await loadExtraPlugins(opts.config.plugins?.extra ?? [], process.cwd());
  const skills = env.state.skills;
  for (const plugin of [
    ...applyRoster(surfacePlugins, disable),
    ...applyRoster(builtins, disable),
    ...extra,
    // Kernel-executable commands (a surface's `/` menu reads its registry).
    kernelCommandsPlugin(env),
    ...(skills.length > 0 ? [skillsPlugin(skills)] : []),
  ]) {
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

/** The built-in roster for one host build (config expansion lives here once). */
function kernelPlugins(env: Environment, opts: CreateKernelOptions): Plugin[] {
  const { config } = opts;
  return builtinPlugins({
    spillReadRoot: env.root.must(spillKey).dir(),
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    subagent: {
      provider: env.provider,
      tools: () => [...env.root.must(toolsKey).all()],
      hooks: env.hooks,
      systemPrompt: env.systemPrompt,
      ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
      rootDir: () => env.state.rootDir,
      ...(opts.onSubagentProgress !== undefined ? { onProgress: opts.onSubagentProgress } : {}),
    },
    bash:
      config.bash === false
        ? false
        : {
            ...(config.bash?.timeoutMs !== undefined ? { timeoutMs: config.bash.timeoutMs } : {}),
            ...(config.bash?.shellPath !== undefined ? { shellPath: config.bash.shellPath } : {}),
          },
    ...(config.code !== undefined ? { code: { ...config.code, mode: env.state.codeMode } } : {}),
  });
}

