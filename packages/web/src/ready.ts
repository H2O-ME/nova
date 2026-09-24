/**
 * The `ready` payload: everything a client needs to rebuild the surface from
 * the durable log — where it is, which model and modes are in force, the frozen
 * baseline's tail, the numbers, and what is still waiting on the user.
 *
 * Its own module because it is a CONTRACT (the attach frame's shape) rather than
 * routing: it reads one fact from each owner (kernel, session handle, model
 * seat, the paged windows) and decides nothing itself. Nothing here may be a
 * value the browser would have to reconcile with a second source.
 */
import type { AgentSession } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import type { ModelSeat } from './model-seat.js';
import type { SessionPages } from './session-pages.js';
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
}): ReadyInfo {
  const { agent, kernel, seat, pages } = opts;
  const cuts = pages.cut(agent, kernel.host.tools);
  const window = seat.contextWindow;
  const named = seat.name !== seat.model;
  return {
    rootDir: kernel.rootDir(),
    sessionFile: agent.session.file,
    model: seat.model,
    ...(named ? { modelName: seat.name } : {}),
    approvalMode: agent.approvalMode ?? 'read-only',
    codeMode: kernel.codeMode(),
    history: cuts.history,
    historyTotal: cuts.historyTotal,
    // The whole log's runs, not just this page's: a resumed session's stats bar
    // must cover every run it ever had.
    runTotals: foldRuns(loggedRuns(agent.session.events)),
    traceTotal: cuts.traceTotal,
    pendingApprovals: agent.pendingApprovals(),
    jobs: agent.jobSnapshots(),
    usedTokens: agent.lastPromptTokens,
    ...(window !== undefined ? { contextWindow: window } : {}),
    modelSwitching: seat.switching,
    // Read at attach time from the live registry: a plugin that registered a
    // command after boot shows up on the next reconnect (and on any attach).
    commands: kernel.commands.map((command) => ({ name: command.name, description: command.description })),
  };
}
