/**
 * The built-in CANDIDATES for one host build: every first-party plugin this
 * kernel could load, with the config expansion done exactly once.
 *
 * Split from `runtime-roster.ts` because the two answer different questions.
 * This module answers "how are `BuiltinOptions` derived from config + live
 * state"; the roster answers "which of the candidates are in force, and in what
 * order". The split also carries a contract: this returns CANDIDATES, including
 * an `advanced` plugin that is currently off — the manager's row for a
 * switched-off plugin comes from here (a plugin with no fiber leaves no trace
 * in the container), and the roster is what filters.
 */
import { sessions as sessionsKey, spill as spillKey, tools as toolsKey, userQuestions as userQuestionsKey } from '@nova-agent/core';
import type { Plugin } from '@nova-agent/core';
import { builtinPlugins } from './builtin/index.js';
import type { CreateKernelOptions } from './runtime-types.js';
import type { Environment } from './runtime-env.js';

/**
 * Every built-in plugin this build could load, in load order.
 *
 * The two ADVANCED built-ins (`subagent`, `ptc`) are offered UNCONDITIONALLY,
 * with their options always supplied: this function returns candidates, and the
 * gate that decides whether an `advanced` row is in force lives in
 * `roster-filter.ts` (tier + `plugins.enable`). Registering them conditionally
 * here instead would make "off" mean "no row at all" — a plugin that is absent
 * from the roster cannot be switched on, which is exactly how `subagent` ended
 * up always-on AND invisible to the switch that should have controlled it.
 *
 * PTC's mode follows the LIVE `state.codeMode`, so `setCodeMode` keeps working
 * through the existing route: the roster translates a non-`native` mode into an
 * `enable` entry (see `runtime-roster.ts`).
 */
export function kernelPlugins(env: Environment, opts: CreateKernelOptions): Plugin[] {
  const { config } = opts;
  return builtinPlugins({
    // The live root, not a snapshot: `switch_workspace` re-points it and every
    // workspace-bound tool must grade against the directory now in force.
    rootDir: () => env.state.rootDir,
    spillReadRoot: env.root.must(spillKey).dir(),
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    subagent: {
      provider: env.provider,
      tools: () => [...env.root.must(toolsKey).all()],
      hooks: env.hooks,
      systemPrompt: env.systemPrompt,
      ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
      rootDir: () => env.state.rootDir,
      // Wired here for the same reason jobs are (`runtime-env.ts`'s
      // `jobs.setListener`): a delegation's lifecycle is a kernel fact every
      // surface wants. Left to callers, none ever supplied it — so
      // `subagent_update` had no producer and the row built for it was
      // unreachable. A surface-supplied callback still wins.
      onProgress:
        opts.onSubagentProgress ??
        ((progress) => { env.root.get(sessionsKey)?.current()?.observeSubagent(progress); }),
    },
    bash:
      config.bash === false
        ? false
        : {
            ...(config.bash?.timeoutMs !== undefined ? { timeoutMs: config.bash.timeoutMs } : {}),
            ...(config.bash?.shellPath !== undefined ? { shellPath: config.bash.shellPath } : {}),
          },
    // Read through the container, lazily (see `userQuestions` in core's
    // capabilities and `userQuestionsProvider`): "can this surface ask a human?"
    // is a SERVICE, so a surface declares it instead of every assembly site
    // hand-copying a boolean. The service is authoritative for surfaces loaded
    // from config (they register in the surface registry).
    //
    // `opts.userQuestions` remains the explicit input for the sites that
    // assemble a kernel for a BUILT-IN surface (web / repl / qqbot / exec):
    // those are cli `SurfaceEntry`s, not registry `AgentSurface`s, so there is
    // no declaration to read — the host that owns them is the only thing that
    // knows whether a person is at that end. NEITHER supplying an answerer means
    // nobody can answer: the fail-closed end, where the tool reports NO_PROVIDER
    // instead of parking a run no card can release.
    askUser: {
      ask: () =>
        env.root.get(userQuestionsKey)?.answerer() ?? (opts.userQuestions === true ? env.questions.asker : undefined),
    },
    // The goal's live value is a SESSION fact (the log is its only store), and a
    // plugin's `apply(ctx)` has no session handle, so it is wired at the
    // assembly point like the feed above. `current` is a getter, not a snapshot:
    // the continuation hook runs per request and must see the current goal.
    goal: {
      current: () => env.root.get(sessionsKey)?.current()?.session.latestGoal() ?? null,
      // Through the session's own announce path, not a raw `appendEvent`: one
      // door keeps "logged" and "published" from drifting apart.
      write: (goal) => { env.root.get(sessionsKey)?.current()?.announceGoal(goal); },
    },
    // Always offered as a candidate, with a mode that is only ever used if the
    // gate lets it load. `native` becomes `both` here because under pure
    // `native` presentation the plugin would be a no-op rather than an
    // opt-in-capable row; the operator who turned PTC on through
    // `setCodeMode` gets their real mode from the live state instead.
    code: { ...config.code, mode: env.state.codeMode === 'native' ? 'both' : env.state.codeMode },
  });
}
