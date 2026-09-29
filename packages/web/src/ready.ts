/**
 * The `ready` payload: everything a client needs to rebuild the surface from
 * the durable log — where it is, which model and modes are in force, the frozen
 * baseline's tail, the numbers, and what is still waiting on the user.
 *
 * Its own module because it is a CONTRACT (the attach frame's shape) rather than
 * routing: it reads one fact from each owner (kernel, session handle, model
 * seat, the paged windows) and decides nothing itself. Nothing here may be a
 * value the browser would have to reconcile with a second source.
 *
 * `pendingQuestions` is load-bearing beyond rendering: a run parked inside an ask
 * has no live event to re-send, so a client attaching after the ask went out
 * learns about it here or not at all.
 */
import type { AgentSession } from '@nova-agent/core';
import { userConfigPath } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import type { ModelSeat } from './model-seat.js';
import type { SessionPages } from './session-pages.js';
import { toWireRosterEntry } from './roster-wire.js';
import { foldRuns, loggedRuns } from './totals.js';
import type { ReadyInfo } from './protocol.js';

/**
 * Assemble the attach payload. The windows are cut HERE (the caller's instance
 * is mutated by `cut`), because `ready` is the moment a client's cursors reset.
 */
export function assembleReady(opts: {
  agent: AgentSession;
  kernel: Kernel;
  seat: ModelSeat;
  pages: SessionPages;
  /** The running version, as the owning shell reported it at boot. */
  version?: string;
}): ReadyInfo {
  const { agent, kernel, seat, pages } = opts;
  const cuts = pages.cut(agent, kernel.host.tools);
  const window = seat.contextWindow;
  const named = seat.name !== seat.model;
  // The whole log's runs (not this page's): the stats bar covers every run the
  // session ever had, and the last one restores the context meter on a resume.
  const runs = loggedRuns(agent.session.events);
  const todos = agent.session.latestTodos();
  return {
    rootDir: kernel.rootDir(),
    sessionFile: agent.session.file,
    ...(opts.version !== undefined ? { version: opts.version } : {}),
    model: seat.model,
    ...(named ? { modelName: seat.name } : {}),
    approvalMode: agent.approvalMode ?? 'read-only',
    codeMode: kernel.codeMode(),
    history: cuts.history,
    historyTotal: cuts.historyTotal,
    // The whole log's runs, not just this page's: a resumed session's stats bar
    // must cover every run it ever had.
    runTotals: foldRuns(runs),
    traceTotal: cuts.traceTotal,
    pendingApprovals: agent.pendingApprovals(),
    pendingQuestions: agent.pendingQuestions(),
    jobs: agent.jobSnapshots(),
    usedTokens: agent.lastPromptTokens,
    ...(window !== undefined ? { contextWindow: window } : {}),
    modelSwitching: seat.switching,
    // The plan lives in the log (last write wins), so a resumed or reattached
    // client reads it here instead of waiting for the next write.
    ...(todos !== undefined ? { todos } : {}),
    // The goal lives in the log too (whole value, last write wins). Sent even when
    // absent, because "no goal" is a real state the panel renders as nothing —
    // there is no third case to distinguish, unlike `todos`.
    goal: agent.session.latestGoal() ?? null,
    // Read at attach time from the live registry, so a plugin that registered a
    // command after boot shows up on the next reconnect (and on any attach).
    commands: kernel.commands.map((command) => ({ name: command.name, description: command.description })),
    // The live roster rides the baseline for the same reason: the settings nav
    // derives which PAGES exist from it, and the `roster` frame only arrives
    // when the plugins panel is mounted. Without this, the first 设置 open after
    // a restart drew the page of a plugin the operator had switched off.
    roster: kernel.roster().map(toWireRosterEntry),
    configPath: userConfigPath(),
  };
}
