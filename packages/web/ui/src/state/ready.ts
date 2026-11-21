/**
 * The (re)attach fold: a `ready` frame rebuilds the transcript from the host's
 * baseline and resets everything session-scoped. Also the two block-level
 * helpers the reducer reuses (replay and the local hint row).
 */
import type { ReadyInfo, WireBlock } from '../types.js';
import { emptyTree } from '../rightbar/files-model.js';
import type { Block, UiState } from './types.js';

/** A (re)attach: rebuild the transcript from the baseline and reset run state. */
export function applyReady(state: UiState, info: ReadyInfo): UiState {
  let seq = 0;
  const history = (info.history ?? []).map((entry: WireBlock) => replayBlock(entry, `b${(seq += 1)}`));
  // Background jobs are not in the log (nothing about them is model-visible
  // until they report), so a reconnect takes the kernel's live snapshots —
  // without this, a reattached surface silently loses its running-job rows.
  const jobs: Block[] = (info.jobs ?? []).map((job) => ({ id: `job:${job.id}`, kind: 'job', job }));
  return {
    ...state,
    connected: true,
    meta: info,
    approvalMode: info.approvalMode,
    model: info.model,
    modelName: info.modelName ?? null,
    modelSwitching: info.modelSwitching,
    // A session switch re-fetches the catalog: the endpoint may be a different
    // one now, and a stale list would offer models this session cannot reach.
    catalog: null,
    // The baseline's roster is the FIRST-PAINT source (the ready frame carries
    // it); the plugins section still re-asks on open because a switch may have
    // re-rostered since — but a nav that had to wait for that ask drew a
    // switched-off plugin's page after a cold start.
    roster: info.roster !== undefined ? { entries: info.roster, configPath: info.configPath ?? '' } : null,
    plugins: null,
    skills: null,
    // A re-baseline is a fresh page: a refusal from the previous one must not
    // keep a switch disabled after the reconnect that re-baselined it.
    manageError: null,
    pluginAnswers: {},
    // Same for the echo wait: a reconnect is not a reply to anything, and a
    // draft parked waiting for an echo belongs to a page that no longer exists.
    awaitingEcho: false,
    // The model list lives in the config file, not in the session, so a
    // re-baseline does not invalidate it — but the panel re-asks on open anyway
    // (the operator may have hand-edited the file between opens).
    modelConfig: null,
    // Same rule for the BYOK provider list: the file is the authority, the panel
    // re-asks on open. The in-flight probe is dropped (its answer belonged to a
    // page that no longer exists).
    providers: null,
    providerProbe: null,
    // Commands are the kernel's, not the session's: the frame re-states them on
    // every attach (a plugin registered after boot is in this list, not the
    // previous one).
    commands: info.commands ?? [],
    todos: info.todos ?? null,
  // Same resume rule as 	odos: the log's goal snapshot is replayed into the panel.
  goal: info.goal ?? null,
    // A baseline that arrives with an outstanding ask is a suspended run, not
    // an idle session: the phase must say so before the first live event. An
    // approval wins the phase when both are somehow present (the kernel
    // serializes asks, so this is a defensive ordering, not a real state).
    phase: info.pendingApprovals.length > 0
      ? 'waiting_approval'
      : info.pendingQuestions.length > 0 ? 'waiting_question' : 'idle',
    pendingApproval: info.pendingApprovals[0] ?? null,
    pendingQuestion: info.pendingQuestions[0] ?? null,
    queued: [],
    usedTokens: info.usedTokens,
    contextWindow: info.contextWindow ?? null,
    blocks: [...history, ...jobs],
    seq,
    historyLoaded: history.length,
    historyTotal: info.historyTotal,
    historyPending: false,
    // A session switch re-baselines everything session-scoped EXCEPT the
    // sidebar's list: a switch can add a session (the one just created) or
    // change the current row's highlight, so the list is re-asked — but the
    // rows already on screen stay, because re-asking is not a reason to blink.
    // A request that was in flight died with the socket that carried it, so
    // the flag resets with the attach rather than waiting for a reply that
    // will never come (which would block every later re-ask).
    sessionsStale: true,
    sessionsPending: false,
    // The pane's view is chrome for ONE session: carried across a switch it
    // stacked the new session's pane under the hero (the reported 上下文/轨迹 +
    // 新会话 overlay — the hero phase renders no tab strip, so a surviving
    // view had no way back), over an empty trace whose rows died with the old
    // log. A re-attach to the SAME session keeps the view: a reconnect must
    // not kick the reader out of the pane they were reading.
    ...(state.meta?.sessionFile !== info.sessionFile ? { view: 'chat' } : {}),
    // The trace window is re-cut on the same attach, so whatever rows the pane
    // held belong to a session that is no longer open: drop them and let an
    // open pane re-read (`traceTotal` says how many there are to read).
    trace: null,
    // Same rule for the Context panel, and a switch off of the plugin: the
    // reading rides the baseline, so a resumed session draws its own window and
    // a plugin now off clears the panel (and drops its tab).
    context: info.context ?? null,
    // The session's numbers come from the HOST's fold over the whole log
    // (this frame carried it), so a resumed session shows the totals of every
    // run it ever had — the live stream then adds each new one.
    totals: info.runTotals,
    // The workspace tree is the WORKSPACE's, not the session's, but a switch can
    // move the workspace too, and a tree drawn from the previous root would be
    // another directory's contents under this one's path. Dropping it makes the
    // panel ask again (the picker's own slot follows the same rule on open).
    tree: emptyTree,
    // The git reading is the WORKSPACE's, and it is stamped with the root it
    // answered for (`GitState.root`): a session switch may move the workspace,
    // and rows from the previous root would decorate this tree with another
    // repository's status. Dropping it makes the panel ask again.
    git: null,
  };
}

/** One replayed log entry → one block (the host already did the interpretation). */
export function replayBlock(entry: WireBlock, id: string): Block {
  switch (entry.kind) {
    case 'tool':
      return {
        id,
        kind: 'tool',
        callId: entry.callId,
        name: entry.name,
        args: entry.args,
        view: entry.view,
        ...(entry.ts !== undefined ? { ts: entry.ts } : {}),
        ...(entry.result !== undefined ? { result: entry.result } : {}),
        ...(entry.output !== undefined ? { output: entry.output } : {}),
      };
    case 'aborted':
      // The log's abort marker is model-facing; the user reads a line about it.
      return { id, kind: 'hint', text: '本轮已中断', tone: 'warn' };
    case 'context':
      return {
        id,
        kind: 'context',
        tag: entry.tag,
        form: entry.form,
        ...(entry.sections !== undefined ? { sections: entry.sections } : {}),
        ...(entry.entries !== undefined ? { entries: entry.entries } : {}),
        ...(entry.note !== undefined ? { note: entry.note } : {}),
        text: entry.text,
      };
    case 'meta':
      // A finished run's line, replayed from the log: the same row the live
      // `run_stats` event built, so a resumed session reads exactly like the
      // session that was running (its clock, duration and throughput intact).
      return { id, kind: 'meta', stats: entry.stats };
    case 'user':
      return {
        id,
        kind: 'user',
        text: entry.text,
        ...(entry.ts !== undefined ? { ts: entry.ts } : {}),
        ...(entry.images !== undefined && entry.images.length > 0 ? { images: entry.images } : {}),
      };
    case 'text':
      return { id, kind: 'text', text: entry.text, streaming: false, ...(entry.ts !== undefined ? { ts: entry.ts } : {}) };
  }
}

export function hint(state: UiState, text: string, tone: 'info' | 'warn'): UiState {
  const seq = state.seq + 1;
  return { ...state, seq, blocks: [...state.blocks, { id: `b${seq}`, kind: 'hint', text, tone }] };
}
