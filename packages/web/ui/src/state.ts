/**
 * The UI state: frames in, state out. Pure function, no React, no timers, no
 * module globals — same state plus same action always yields the same state
 * (block ids are minted from `seq` inside the state, so two runs of the same
 * frame sequence produce identical output).
 *
 * Two contracts it lives by:
 *  - **The durable log is the truth.** A (re)`ready` frame REPLACES the
 *    transcript with the host's projection of the log; sockets are disposable.
 *    Note what is NOT here: no message parsing, no per-tool knowledge — the
 *    host resolves render intent (`view`/`resultView`) and ships blocks.
 *  - **Views come from the vocabulary.** Tool rows render `switch (view.card)`;
 *    a card this bundle has never seen still renders from its own fields,
 *    because `generic` is always available as the fallback.
 *
 * Frame-level bookkeeping (attach, sessions, pagination, host errors) lives in
 * this file; one case per kernel event lives next door in `state-events.ts`.
 */
import type {
  ApprovalMode, ApprovalRequest, ClientFrame, CommandSummary, JobSnapshot, KernelEvent, ModelGroup, PtcMode, ReadyInfo,
  RunStats, SessionListItem, SubagentUsage, ToolCallView, ToolResultView, TurnPhase, WireBlock, WireTraceRow,
} from './types.js';
import { reduceEvent } from './state-events.js';

export type Block =
  | { id: string; kind: 'user'; text: string; /** The log's timestamp (the row's clock). */ ts?: number }
  | { id: string; kind: 'text'; text: string; streaming: boolean; /** The message's timestamp. */ ts?: number }
  | { id: string; kind: 'reasoning'; text: string; streaming: boolean }
  | {
      id: string;
      kind: 'tool';
      callId: string;
      name: string;
      args: string;
      view: ToolCallView;
      /** When the call started (the transcript's clock; log ts on replay). */
      ts?: number;
      /** Absent until the call reports — the row renders as in-flight. */
      result?: ToolResultView;
      /** The result text, for the detail panel. */
      output?: string;
      /** Live tail line while the call runs (bash output etc.). */
      tail?: string;
    }
  | { id: string; kind: 'hint'; text: string; tone: 'info' | 'warn' }
  /**
   * One section of the seeded session-start context fragment: what the kernel
   * injected before the first turn, drawn as a disclosure row. Log-only —
   * nothing about it is live, so it arrives with the `ready` baseline and its
   * body is the model-facing bytes.
   */
  | {
      id: string;
      kind: 'context';
      tag: string;
      form: 'snapshot' | 'catalog' | 'text';
      sections?: readonly { name: string; text: string }[];
      entries?: readonly { name: string; description: string }[];
      /** The catalog form's non-entry lines, when any. */
      note?: string;
      text: string;
    }
  /** A finished run's numbers, rendered as the turn's meta row. */
  | { id: string; kind: 'meta'; stats: RunStats }
  /**
   * One slash command's lifecycle row: opened by `command/run`, rewritten in
   * place by the matching `command/done` (the `jobs` recipe). It exists because
   * a command is something the *user* did to the session, so it leaves a line in
   * the transcript the way a prompt does.
   */
  | { id: string; kind: 'command'; name: string; running: boolean; text?: string }
  /** One background job, updated in place by id for the life of the job. */
  | { id: string; kind: 'job'; job: JobSnapshot }
  /** One nested subagent, updated in place by label for the life of the run. */
  | { id: string; kind: 'sub'; sub: SubRow };

/** A nested run's live row; `state-events.ts` owns how it fills in. */
export interface SubRow {
  label: string;
  status: 'running' | 'completed' | 'aborted' | 'ended';
  /** Tool calls the nested loop has dispatched so far. */
  calls: number;
  /** The nested call it is on right now, one line. */
  detail?: string;
  /** The nested run's totals, once it reports `done`. */
  usage?: SubagentUsage;
}

/** A block without its identity — ids are minted by the reducer, never by callers. */
export type Draft = Block extends infer B ? (B extends { id: string } ? Omit<B, 'id'> : never) : never;

/** One fetch of the model catalog (`list_models` in flight, or its answer). */
export interface ModelCatalog {
  groups: readonly ModelGroup[];
  loading: boolean;
  /** Why the endpoint could not be asked (the menu shows it beside a Retry). */
  error?: string;
}

export interface UiState {
  connected: boolean;
  meta: ReadyInfo | null;
  approvalMode: ApprovalMode;
  codeMode: PtcMode;
  /** The model in force (`ready`/`state`, and the kernel's `model` event). */
  model: string;
  /**
   * The catalog's display name for it, when the host has metadata (an endpoint
   * publishes ids, never labels). Null → the seat shows `model`.
   */
  modelName: string | null;
  /** Whether this kernel can switch models at all (the seat's render gate). */
  modelSwitching: boolean;
  /**
   * The picker's catalog: null until the menu is first opened (the list is
   * fetched on demand, never at attach), then rows or the reason there are
   * none — "no models" and "could not ask" are different answers and the menu
   * words them differently.
   */
  catalog: ModelCatalog | null;
  /**
   * The kernel's command catalog (what `/` can run), as `ready` published it.
   * It is not fetched on demand like the model list: the kernel answers from its
   * own registry, so it is always available and always current at attach.
   */
  commands: readonly CommandSummary[];
  blocks: Block[];
  /** The block-id counter (see the header: ids are state, not a global). */
  seq: number;
  phase: TurnPhase | 'disconnected';
  pendingApproval: ApprovalRequest | null;
  queued: readonly string[];
  turnCount: number;
  /** Prompt tokens of the last request (the context gauge's numerator). */
  usedTokens: number;
  contextWindow: number | null;
  /**
   * Session switcher contents; null = never fetched in this browser session.
   * The list OUTLIVES a `ready`: every attach re-states the transcript, but the
   * list is not part of it — blanking it would show "loading" on every switch
   * and re-ask for what the sidebar is already holding.
   */
  sessions: readonly SessionListItem[] | null;
  /**
   * The list is worth re-asking (an attach landed, or a switch may have added
   * a session). The host's answer settles it; a stale list keeps rendering
   * meanwhile, which is why this is not "sessions = null".
   */
  sessionsStale: boolean;
  /** A `list_sessions` request is in flight (single-flight, same rule as paging). */
  sessionsPending: boolean;
  /** Baseline blocks the browser holds (from `ready` plus `load_earlier`). */
  historyLoaded: number;
  /** Blocks the baseline has in all — anything above `historyLoaded` is older. */
  historyTotal: number;
  /**
   * A `load_earlier` page is in flight. Owned here because the reply is the
   * only thing that can settle it: the reducer sees both the request going out
   * and every frame coming back, so a double click cannot queue two pages and a
   * dropped socket cannot leave the button loading forever.
   */
  historyPending: boolean;
  /**
   * Which view the session pane shows. A view switch is browser state, not
   * session state: it is not logged, not sent anywhere, and resets with the
   * baseline like every other per-attach choice.
   */
  view: SessionViewId;
  /**
   * The trace view: rows as of its last read, plus how many the log holds. Null
   * until the view is first opened — the log is read on demand, because most
   * visits never leave the conversation.
   */
  trace: TraceState | null;
  /** Cumulative run numbers for the stats bar (session-scoped, like the kernel's). */
  totals: SessionTotals;
}

/** The session pane's view ids (the header's tabs, ported from the source's ledger). */
export type SessionViewId = 'chat' | 'trace';

/**
 * Session-cumulative numbers and their zero are the web package's (`totals.ts`,
 * shared with the host, which folds the whole log for `ready`).
 */
import { emptyTotals, type SessionTotals } from '../../src/totals';

export type { SessionTotals };

/** The trace view's fetched state. */
export interface TraceState {
  /** Rows held, oldest first (the newest page arrives as the tail). */
  rows: readonly WireTraceRow[];
  /** Rows the durable log holds in all — above `rows.length` are older. */
  total: number;
  /** A `load_trace` page is in flight (the same one-owner rule as `historyPending`). */
  pending: boolean;
  /**
   * The cursor the in-flight (or last) request carried: 0 means a fresh read,
   * which is how its answer is folded in (`state` owns that rule, not the
   * payload's shape).
   */
  have: number;
}

export const initialState: UiState = {
  connected: false,
  meta: null,
  approvalMode: 'read-only',
  codeMode: 'native',
  model: '',
  modelName: null,
  modelSwitching: false,
  catalog: null,
  commands: [],
  blocks: [],
  seq: 0,
  phase: 'idle',
  pendingApproval: null,
  queued: [],
  turnCount: 0,
  usedTokens: 0,
  contextWindow: null,
  sessions: null,
  sessionsStale: false,
  sessionsPending: false,
  historyLoaded: 0,
  historyTotal: 0,
  historyPending: false,
  view: 'chat',
  trace: null,
  totals: emptyTotals,
};

export type Action =
  | { type: 'connection'; connected: boolean }
  /** A frame the client just put on the socket — request-side state the
   *  server's replies alone cannot account for (the pagination in-flight flag). */
  | { type: 'sent'; frame: ClientFrame }
  | { type: 'ready'; info: ReadyInfo }
  | { type: 'event'; event: KernelEvent; view?: ToolCallView; resultView?: ToolResultView }
  | { type: 'state'; approvalMode: ApprovalMode; codeMode: PtcMode; model: string; modelName?: string }
  | { type: 'models'; groups: readonly ModelGroup[]; current: string; error?: string }
  | { type: 'sessions'; items: readonly SessionListItem[] }
  | { type: 'history_earlier'; blocks: readonly WireBlock[]; total: number }
  | { type: 'trace'; rows: readonly WireTraceRow[]; total: number }
  /**
   * The user picked a view. A local action, not a frame: the host has no
   * opinion about which pane is on screen, and nothing about it is durable.
   */
  | { type: 'select_view'; view: SessionViewId }
  | { type: 'error'; message: string };

export function reduce(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'connection':
      return {
        ...state,
        connected: action.connected,
        // 'disconnected' is synthetic (not a kernel TurnPhase): a reconnect must
        // clear it, or the badge outlives the disconnect until the next event.
        phase: action.connected ? (state.phase === 'disconnected' ? 'idle' : state.phase) : 'disconnected',
        // A dropped socket means the reply cannot arrive: unblock the button
        // rather than leave it spinning until the reconnect re-baselines.
        historyPending: action.connected ? state.historyPending : false,
        // Same rule for the trace page: a dropped socket cannot deliver it.
        trace: state.trace !== null && !action.connected ? { ...state.trace, pending: false } : state.trace,
      };
    case 'sent':
      if (action.frame.type === 'load_earlier') return { ...state, historyPending: true };
      // A trace read going out marks its own page in flight; rows already held
      // stay on screen (the pane shows them under the refresh).
      if (action.frame.type === 'load_trace') {
        return {
          ...state,
          trace: {
            rows: state.trace?.rows ?? [],
            total: state.trace?.total ?? 0,
            pending: true,
            have: action.frame.have,
          },
        };
      }
      if (action.frame.type === 'list_sessions') {
        // Same rule as the catalog: the request went out, so the answer is
        // what settles it — and the list stays on screen until it does.
        return { ...state, sessionsStale: false, sessionsPending: true };
      }
      // Opening the catalog marks the fetch in flight HERE, not in the menu:
      // the reducer sees the request go out and the reply come back, so a menu
      // closed and reopened cannot show a stale answer as fresh.
      if (action.frame.type === 'list_models') {
        return { ...state, catalog: { groups: state.catalog?.groups ?? [], loading: true } };
      }
      return state;
    case 'ready':
      return applyReady(state, action.info);
    case 'event':
      return reduceEvent(state, action.event, action.view, action.resultView);
    case 'state':
      return {
        ...state,
        approvalMode: action.approvalMode,
        codeMode: action.codeMode,
        model: action.model,
        // No name in the frame means the host has none for this model: keeping
        // the previous model's would label the new one with the old one's name.
        modelName: action.modelName ?? null,
      };
    case 'models':
      return {
        ...state,
        model: action.current,
        catalog: {
          groups: action.groups,
          loading: false,
          ...(action.error !== undefined ? { error: action.error } : {}),
        },
      };
    case 'sessions':
      return { ...state, sessions: action.items, sessionsStale: false, sessionsPending: false };
    case 'history_earlier': {
      // Older blocks go in FRONT; the cursor is what the browser now holds.
      let seq = state.seq;
      const older = action.blocks.map((entry) => replayBlock(entry, `b${(seq += 1)}`));
      return {
        ...state,
        blocks: [...older, ...state.blocks],
        seq,
        historyLoaded: state.historyLoaded + action.blocks.length,
        historyTotal: action.total,
        historyPending: false,
      };
    }
    case 'trace':
      // Which request this answers is decided by the cursor it was sent with,
      // not by guessing from the payload: `have: 0` asked for a fresh read (the
      // page IS the newest tail and replaces what was held), any other cursor
      // asked for the rows immediately older than those (they go in FRONT).
      return {
        ...state,
        trace: {
          rows: state.trace !== null && state.trace.have > 0
            ? [...action.rows, ...state.trace.rows]
            : action.rows,
          total: action.total,
          pending: false,
          have: state.trace !== null && state.trace.have > 0 ? state.trace.have + action.rows.length : action.rows.length,
        },
      };
    case 'select_view':
      return { ...state, view: action.view };
    case 'error':
      // A host error IS the reply to whatever was in flight: it settles too.
      return {
        ...hint(state, `宿主提示：${action.message}`, 'warn'),
        historyPending: false,
        sessionsPending: false,
        trace: state.trace !== null ? { ...state.trace, pending: false } : null,
      };
  }
}

/** A (re)attach: rebuild the transcript from the baseline and reset run state. */
function applyReady(state: UiState, info: ReadyInfo): UiState {
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
    codeMode: info.codeMode,
    model: info.model,
    modelName: info.modelName ?? null,
    modelSwitching: info.modelSwitching,
    // A session switch re-fetches the catalog: the endpoint may be a different
    // one now, and a stale list would offer models this session cannot reach.
    catalog: null,
    // Commands are the kernel's, not the session's: the frame re-states them on
    // every attach (a plugin registered after boot is in this list, not the
    // previous one).
    commands: info.commands ?? [],
    // A baseline that arrives with an outstanding ask is a suspended run, not
    // an idle session: the phase must say so before the first live event.
    phase: info.pendingApprovals.length > 0 ? 'waiting_approval' : 'idle',
    pendingApproval: info.pendingApprovals[0] ?? null,
    queued: [],
    // A session switch re-baselines everything session-scoped EXCEPT the
    // sidebar's list: a switch can add a session (the one just created) or
    // change the current row's highlight, so the list is re-asked — but the
    // rows already on screen stay, because re-asking is not a reason to blink.
    // A request that was in flight died with the socket that carried it, so
    // the flag resets with the attach rather than waiting for a reply that
    // will never come (which would block every later re-ask).
    sessionsStale: true,
    sessionsPending: false,
    usedTokens: info.usedTokens,
    contextWindow: info.contextWindow ?? null,
    blocks: [...history, ...jobs],
    seq,
    historyLoaded: history.length,
    historyTotal: info.historyTotal,
    historyPending: false,
    // The trace window is re-cut on the same attach, so whatever rows the pane
    // held belong to a session that is no longer open: drop them and let an
    // open pane re-read (`traceTotal` says how many there are to read).
    trace: null,
    // The session's numbers come from the HOST's fold over the whole log
    // (this frame carried it), so a resumed session shows the totals of every
    // run it ever had — the live stream then adds each new one.
    totals: info.runTotals,
  };
}

/** One replayed log entry → one block (the host already did the interpretation). */
function replayBlock(entry: WireBlock, id: string): Block {
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
      return { id, kind: 'user', text: entry.text, ...(entry.ts !== undefined ? { ts: entry.ts } : {}) };
    case 'text':
      return { id, kind: 'text', text: entry.text, streaming: false, ...(entry.ts !== undefined ? { ts: entry.ts } : {}) };
  }
}

function hint(state: UiState, text: string, tone: 'info' | 'warn'): UiState {
  const seq = state.seq + 1;
  return { ...state, seq, blocks: [...state.blocks, { id: `b${seq}`, kind: 'hint', text, tone }] };
}