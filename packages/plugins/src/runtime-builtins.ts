/**
 * The built-in CANDIDATES for one host build: every first-party plugin this
 * kernel could load, with the config expansion done exactly once.
 *
 * Split from `runtime-roster.ts` because the two answer different questions.
 * This module answers "how are `BuiltinOptions` derived from config + live
 * state"; the roster answers "which of the candidates are in force, and in what
 * order". The split also carries a contract: this returns CANDIDATES — the
 * manager's rows for switched-off plugins come from the manifest, and the
 * roster is what filters.
 *
 * The `advanced` EXTENSION plugins (subagent / context / ptc) are NOT here:
 * they load from their own packages only when enabled (`extensions.ts`), so
 * this file is the base roster and nothing in it needs a module that could be
 * absent.
 */
import { sessions as sessionsKey, spill as spillKey, userQuestions as userQuestionsKey } from '@nova-agent/core';
import type { Plugin } from '@nova-agent/core';
import { builtinPlugins } from './builtin/index.js';
import type { CreateKernelOptions } from './runtime-types.js';
import type { Environment } from './runtime-env.js';

/**
 * Every built-in plugin this build could load, in load order.
 *
 * `BuiltinOptions` derivation lives here and nowhere else: options are always
 * supplied so the base roster is unconditional, and "may this row run" stays a
 * pure lookup in `roster-filter.ts` (tier + `plugins.enable`) — two answerers
 * would drift.
 */
export function kernelPlugins(env: Environment, opts: CreateKernelOptions): Plugin[] {
  const { config } = opts;
  return builtinPlugins({
    // The live root, not a snapshot: `switch_workspace` re-points it and every
    // workspace-bound tool must grade against the directory now in force.
    rootDir: () => env.state.rootDir,
    spillReadRoot: env.root.must(spillKey).dir(),
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
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
    // `opts.userQuestions` remains the explicit input for assemblies with no
    // surface registry (kernel tests, embedders): the registry's recorded
    // winner is the primary source for every cli surface (built-in and
    // configured alike — see `cli/src/surface-host.ts`). NEITHER supplying an
    // answerer means nobody can answer: the fail-closed end, where the tool
    // reports NO_PROVIDER instead of parking a run no card can release.
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
  });
}
