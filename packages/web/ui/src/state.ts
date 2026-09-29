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
  ApprovalMode, ApprovalRequest, ClientFrame, CommandSummary, ConfiguredModel, Goal, JobSnapshot, KernelEvent, ModelCapabilities, ModelGroup, PtcMode, QuestionRequest, ReadyInfo,
  RunStats, SessionListItem, SubagentUsage, TodoItem, ToolCallView, ToolResultView, TurnPhase, WireBlock,
  WireDirectoryLevel, WireFileEntry, WireProviderRow, WireRosterEntry, WireSkillEntry, WireTraceRow,
} from './types.js';
import { reduceEvent } from './state-events.js';
import { treeAsk, treeError, treeLevel, emptyTree, type TreeState } from './rightbar/files-model.js';
import { emptyTerminal, terminalForSession, upsertTerminal, type TerminalFrameState, type TerminalState } from './rightbar/terminal-model.js';

export type Block =
  | {
      id: string;
      kind: 'user';
      text: string;
      /** The log's timestamp (the row's clock). */
      ts?: number;
      /**
       * Images this prompt attached, by reference. The pixels are fetched from
       * the id-addressed route when the row draws (`imageRefUrl`), never carried
       * in the transcript: a reload must show the attachment the conversation
       * actually had, and the bytes live in the store, not in the frame.
       */
      images?: readonly { id: string; mediaType: string }[];
    }
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

/** The plugin roster's last snapshot (`roster` frame) and the config's seat. */
export interface RosterSnapshot {
  entries: readonly WireRosterEntry[];
  configPath: string;
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
   * The live plugin roster, as the settings panel's plugins section asked it.
   * A snapshot, not a subscription: the section re-asks on every open (a
   * workspace switch re-rosters tools, so a cached list could lie).
   */
  roster: RosterSnapshot | null;
  /**
   * The plugin manager's last snapshot (answer to a `set_plugin_enabled`
   * flip): the full roster as the panel draws it, with the disable list now in
   * force. Null until the first flip lands — the manager's rows render from
   * `roster` until then.
   */
  plugins: PluginsSnapshot | null;
  /**
   * The Skill 中心's last snapshot (answer to `list_skills` /
   * `set_skill_enabled`). Null until the section's first ask lands.
   */
  skills: SkillsSnapshot | null;
  /**
   * Why the last management request (a plugin or skill switch, a qqbot save or
   * probe) was refused, or null when nothing is outstanding. A refusal arrives
   * as an `error` frame, NOT as a fresh snapshot — so a section waiting on "the
   * next answer settles my in-flight control" would wait forever, leaving that
   * control disabled. This is that missing signal.
   *
   * Bumped on every error (a counter, not a flag) so a second refusal of the
   * same text is still a change the sections can observe.
   */
  manageError: { readonly seq: number; readonly message: string } | null;
  /**
   * The qqbot page's connection snapshot (answer to `qqbot` / `save_qqbot`) —
   * never the secret. Null until the page's first ask lands.
   */
  qqbot: QqBotSnapshot | null;
  /**
   * The qqbot probe's last answer (to `test_qqbot`). Cleared whenever the page
   * re-asks or the operator edits a field — a result belongs to the exact
   * credentials it tested.
   */
  qqbotTest: QqBotTest | null;
  /** The operator's editable model list (null until asked). */
  modelConfig: ModelConfigSnapshot | null;
  /**
   * The BYOK provider list (null until asked). Empty `providers` is the
   * first-run state and renders the "add your first endpoint" form — see
   * {@link ProvidersSnapshot}.
   *
   * Refusals ride the shared `manageError` channel rather than one of their own:
   * every managed section shows the same "the host said no" sentence, and a
   * per-section error field would let two panels disagree about which one failed.
   */
  providers: ProvidersSnapshot | null;
  /** The provider probe's last answer, tagged with the address it tested. */
  providerProbe: ProviderProbe | null;
  /**
   * The kernel's command catalog (what `/` can run), as `ready` published it.
   * It is not fetched on demand like the model list: the kernel answers from its
   * own registry, so it is always available and always current at attach.
   */
  commands: readonly CommandSummary[];
  /**
   * The model's current plan, or null when it never wrote one. Replaced
   * wholesale on every `todo` event (the tool is last-write-wins, so there is
   * no diff to accumulate) and restored from `ready` on a resume.
   */
  todos: readonly TodoItem[] | null;
  /**
   * The goal in force, or null when there is none. Same whole-value,
   * last-write-wins discipline as `todos` (the log's `goal/change` is the durable
   * record), and restored from `ready.goal` on a resume.
   */
  goal: Goal | null;
  blocks: Block[];
  /** The block-id counter (see the header: ids are state, not a global). */
  seq: number;
  phase: TurnPhase | 'disconnected';
  pendingApproval: ApprovalRequest | null;
  /**
   * The outstanding `ask_user_question` batch, or null. Same slot discipline as
   * `pendingApproval` (the kernel serializes asks, so at most one) and it must
   * survive a `ready`: a run parked inside the ask has no other way to be
   * released from the browser.
   */
  pendingQuestion: QuestionRequest | null;
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
  /**
   * The `@` menu's answer: workspace entries for the query the host last
   * answered, or null when no answer has landed. Keyed by `query` because a
   * reply for abandoned text must not replace the rows for what is typed now
   * (the client asks per keystroke and the host answers in walk order).
   */
  files: FileListState | null;
  /**
   * The workspace picker's directory browser: the level the host last listed,
   * or null while none has been asked for. Held here rather than in the
   * dialog's component state because the answer is a frame — the dialog is
   * unmounted whenever it closes, and the reducer is the only thing that sees
   * both the request and its reply.
   */
  directory: DirectoryState | null;
  /**
   * The right panel's workspace tree: one level per absolute path, as the host
   * answered `list_directory`, plus the paths still in flight.
   *
   * The same `directory` frames feed this and the picker's `directory` slot: the
   * answer is keyed by the host's own absolute path, so both readers can take it
   * and neither has to ask twice. `rightbar/files-model.ts` owns the fold.
   */
  tree: TreeState;
  /**
   * The right panel's terminal: the commands this panel ran and their output so
   * far. Output arrives as `terminal` frames and is drained (not re-sent), so
   * this slice is the panel's own screen — see `rightbar/terminal-model.ts`.
   */
  terminal: TerminalState;
  /** Cumulative run numbers for the stats bar (session-scoped, like the kernel's). */
  totals: SessionTotals;
}

/** The session pane's view ids (the header's tabs, ported from the source's ledger). */
export type SessionViewId = 'chat' | 'trace';

/** One Skill 中心 answer: discovered skills with their switch state. */
export interface SkillsSnapshot {
  items: readonly WireSkillEntry[];
  /** The disable list now in force (what a flip wrote). */
  disable: readonly string[];
}

/** The plugin manager's last snapshot: the full roster as the panel draws it. */
export interface PluginsSnapshot {
  entries: readonly WireRosterEntry[];
  /** The disable list now in force (what a flip wrote). */
  disable: readonly string[];
}

/** The qqbot page's connection snapshot (never the secret — see protocol.ts). */
export interface QqBotSnapshot {
  appId?: string;
  hasClientSecret?: boolean;
  clientSecretRef?: string;
  /**
   * Why the bot cannot connect right now, when the host loaded its config with
   * an unresolved `{env:NAME}` — a sentence to show as-is. This is how a
   * misconfigured PLUGIN reports itself: the shell still starts, and the panel
   * that owns the plugin is where the reader learns about it.
   */
  error?: string;
}

/** The qqbot probe's last answer (success carries the gateway URL). */
export interface QqBotTest {
  ok: boolean;
  gateway?: string;
  message?: string;
}

/**
 * The operator's editable model list (config `models[]`), as the host last
 * reported it.
 *
 * `models: []` means NO list is stored and the endpoint's own catalog is in
 * charge — not "there are no models". The panel says exactly that, because the
 * two are opposite facts and only one of them is worth editing.
 */
export interface ModelConfigSnapshot {
  models: readonly ConfiguredModel[];
  /** The endpoint's own published ids (so a removed one can be added back). */
  published: readonly string[];
  /**
   * models.dev's answer per id, with NO overrides applied — the per-field
   * placeholder. `undefined` for an id key means "the automatic source does not
   * know this one", which is a real answer and renders as nothing rather than as
   * a fabricated default.
   */
  automatic: Readonly<Record<string, ModelCapabilities | undefined>>;
}

/**
 * The BYOK provider list, as the host last described it.
 *
 * `providers: []` is the FIRST-RUN state, and it is not an error: nothing has
 * been configured yet, so the page shows the "add your first endpoint" form
 * rather than an empty list. `activeId` absent means the same thing — there is
 * nothing to be in force.
 *
 * `probe` is the last `probe_provider` answer, tagged with the baseURL it
 * belongs to: a probe is a network round trip and the operator may have typed a
 * different address by the time it lands, so a stale answer is discarded rather
 * than shown against the wrong endpoint (the same rule the `@` menu follows).
 */
export interface ProvidersSnapshot {
  providers: readonly WireProviderRow[];
  activeId?: string | undefined;
}

/** The probe's outcome, tagged with the address it was asked about. */
export interface ProviderProbe {
  baseURL: string;
  ok: boolean;
  models: readonly string[];
  message?: string | undefined;
  /** True while the round trip is in flight (the button reads 获取中…). */
  pending: boolean;
}

/** One `@` menu answer, tagged with the query that produced it. */export interface FileListState {
  /** The query this answer belongs to (a reply for older text is discarded). */
  query: string;
  items: readonly WireFileEntry[];
  /** The walk hit its cap: more entries exist than are listed. */
  truncated: boolean;
  /** A `list_files` request is in flight (the menu shows its loading row). */
  pending: boolean;
}

/**
 * The workspace picker's directory browser, as the host last described it.
 *
 * `level` and `error` are mutually exclusive readings of one request, and they
 * are kept apart on purpose: an empty `level` means the folder has nothing in
 * it, while an `error` means the folder could not be looked at. A single
 * nullable field would make an unreadable mount indistinguishable from an empty
 * one, which is the one confusion this dialog cannot afford.
 */
export interface DirectoryState {
  /**
   * The level on screen. Null only before the first answer lands; a refusal
   * keeps the PREVIOUS level so a failed navigation leaves the user where they
   * were rather than on a blank sheet.
   */
  level: WireDirectoryLevel | null;
  /** Why the last request failed, or null. Rendered above the panes. */
  error: string | null;
  /** A `list_directory` / `create_directory` is in flight. */
  pending: boolean;
  /**
   * The picker is choosing a FILE rather than a workspace folder.
   *
   * Carried in the state rather than the dialog's own props because the two
   * callers are different surfaces: the workspace chip opens a folder picker,
   * the composer's `+` menu opens a file picker, and the dialog must know which
   * kind of row to draw AFTER the frame's answer lands (`kind` is present only
   * when the host was asked with `files: true`).
   */
  mode: 'directory' | 'file';
}

/**
 * Session-cumulative numbers and their zero are the web package's (`totals.ts`,
 * shared with the host, which folds the whole log for `ready`).
 */
import { emptyTotals, type SessionTotals } from '../../src/totals';

export type { SessionTotals };

/** The trace view's fetched state. */
export interface TraceState {  /** Rows held, oldest first (the newest page arrives as the tail). */
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
  roster: null,
  plugins: null,
  skills: null,
  manageError: null,
  qqbot: null,
  qqbotTest: null,
  modelConfig: null,
  providers: null,
  providerProbe: null,
  commands: [],
  todos: null,
  goal: null,
  blocks: [],
  seq: 0,
  phase: 'idle',
  pendingApproval: null,
  pendingQuestion: null,
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
  files: null,
  directory: null,
  tree: emptyTree,
  terminal: emptyTerminal,
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
  | { type: 'roster'; entries: readonly WireRosterEntry[]; configPath: string }
  | { type: 'plugins'; entries: readonly WireRosterEntry[]; disable: readonly string[] }
  | { type: 'skills'; items: readonly WireSkillEntry[]; disable: readonly string[] }
  | { type: 'qqbot'; snapshot: QqBotSnapshot }
  | { type: 'model_config'; models: readonly ConfiguredModel[]; published: readonly string[]; automatic: Readonly<Record<string, ModelCapabilities>> }
  | { type: 'providers'; providers: readonly WireProviderRow[]; activeId?: string }
  /** The host's answer to `probe_provider` (success or reason), same shape. */
  | { type: 'provider_probe'; baseURL: string; ok: boolean; models: readonly string[]; message?: string }
  | { type: 'qqbot_test'; result: QqBotTest }
  /** The operator edited a qqbot field: the probe's answer no longer applies. */
  | { type: 'qqbot_test_clear' }
  | { type: 'sessions'; items: readonly SessionListItem[] }
  | { type: 'files'; query: string; items: readonly WireFileEntry[]; truncated: boolean }
  | { type: 'directory'; level: WireDirectoryLevel }
  | { type: 'directory_error'; message: string }
  /**
   * One `terminal` frame from the right panel's terminal: a job's status plus
   * the output produced since this client's last read. The fold (append text,
   * replace state) lives in `rightbar/terminal-model.ts` — the reducer only
   * routes it to the slice.
   */
  | { type: 'terminal'; frame: TerminalFrameState }
  /**
   * The user opened a directory request (navigated, or created a folder). A
   * local action: it marks the request in flight HERE, because the reducer is
   * the only place that sees both the intent and the frame that settles it.
   */
  | { type: 'directory_ask' }
  /** The directory browser opened or closed; closing drops the fetched level. */
  | { type: 'directory_open'; open: boolean; mode?: 'directory' | 'file' }
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
        // …and for the directory picker, where a stuck flag is worse than a
        // spinner: the dialog gates its own opening ask on `!pending` and
        // disables both 新建文件夹 and 打开 while it is set, so a disconnect during
        // a listing left the reader in a dead end that only closing and
        // reopening could escape.
        directory: state.directory !== null && !action.connected
          ? { ...state.directory, pending: false }
          : state.directory,
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
      if (action.frame.type === 'list_files') {
        // The in-flight flag rides the query: the menu shows its loading row
        // only while the answer on screen is for the text being typed.
        return { ...state, files: { query: action.frame.query, items: [], truncated: false, pending: true } };
      }
      if (action.frame.type === 'list_directory' && action.frame.dir !== undefined) {
        // The right panel's tree marks the level it is waiting for, so its row
        // shows a loading line instead of looking like an empty directory. The
        // picker's own asks (`directory_ask`) keep their separate flag: they are
        // one level at a time and the dialog owns that gesture.
        return { ...state, tree: treeAsk(state.tree, action.frame.dir) };
      }
      if (action.frame.type === 'probe_provider') {
        // The provider probe's in-flight flag rides its ADDRESS for the same
        // reason: the round trip outlives an edit, and an answer for text the
        // operator has since changed must not be shown against the new address.
        return {
          ...state,
          providerProbe: { baseURL: action.frame.baseURL, ok: false, models: [], pending: true },
        };
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
    case 'model_config':
      return {
        ...state,
        modelConfig: {
          models: action.models,
          published: action.published,
          automatic: action.automatic,
        },
        manageError: null,
      };
    case 'providers':
      return {
        ...state,
        providers: {
          providers: action.providers,
          ...(action.activeId !== undefined ? { activeId: action.activeId } : {}),
        },
      };
    case 'provider_probe':
      return {
        ...state,
        providerProbe: {
          baseURL: action.baseURL,
          ok: action.ok,
          models: action.models,
          ...(action.message !== undefined ? { message: action.message } : {}),
          pending: false,
        },
      };
    case 'roster':
      return { ...state, roster: { entries: action.entries, configPath: action.configPath } };
    case 'plugins':
      // A flip's answer re-states BOTH halves: the roster snapshot (which the
      // manager draws) and the full `roster` frame's rows (which `/plugins`
      // parity reads) — one answer, no second ask.
      return {
        ...state,
        plugins: { entries: action.entries, disable: action.disable },
        roster: state.roster !== null ? { entries: action.entries, configPath: state.roster.configPath } : state.roster,
      };
    case 'skills':
      return { ...state, skills: { items: action.items, disable: action.disable } };
    case 'qqbot':
      // A save/re-ask settles the probe: the result belonged to the credentials
      // on screen before this answer, not after.
      return { ...state, qqbot: action.snapshot, qqbotTest: null };
    case 'qqbot_test':
      return { ...state, qqbotTest: action.result };
    case 'qqbot_test_clear':
      return { ...state, qqbotTest: null };
    case 'sessions':
      return { ...state, sessions: action.items, sessionsStale: false, sessionsPending: false };
    case 'files':
      // A reply for text the user has already typed past is dropped: replacing
      // the rows now would show candidates for a query nobody is asking.
      if (state.files !== null && state.files.pending && state.files.query !== action.query) return state;
      return { ...state, files: { query: action.query, items: action.items, truncated: action.truncated, pending: false } };
    case 'directory_open':
      // Closing drops the level: the host may have changed underneath (another
      // tool created a folder), and a stale tree shown as current is worse than
      // one re-asked for. Opening keeps whatever was there for the same reason
      // the session list survives a reconnect.
      return action.open
        ? { ...state, directory: state.directory ?? { level: null, error: null, pending: false, mode: action.mode ?? 'directory' } }
        : { ...state, directory: null };
    case 'directory_ask':
      return {
        ...state,
        directory: {
          level: state.directory?.level ?? null,
          error: null,
          pending: true,
          mode: state.directory?.mode ?? 'directory',
        },
      };
    case 'directory':
      // The error clears because a level DID arrive: the previous refusal was
      // about a different path. The same answer feeds the right panel's tree
      // (keyed by the host's own absolute path): one frame, two readers, and no
      // second ask — the picker and the panel may both have one in flight.
      return {
        ...state,
        tree: treeLevel(state.tree, action.level),
        directory: {
          level: action.level,
          error: null,
          pending: false,
          mode: state.directory?.mode ?? 'directory',
        },
      };
    case 'directory_error':
      // The previous level is kept: a failed navigation returns the user to
      // where they were with the reason stated, not to a blank dialog. The tree
      // marks whatever it was waiting for as refused (the frame carries no path;
      // see `files-model.treeError`).
      return {
        ...state,
        tree: treeError(state.tree, action.message),
        directory: {
          level: state.directory?.level ?? null,
          error: action.message,
          pending: false,
          mode: state.directory?.mode ?? 'directory',
        },
      };
    case 'terminal':
      return { ...state, terminal: upsertTerminal(state.terminal, action.frame) };
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
    case 'error': {
      // A host error IS the reply to whatever was in flight: it settles too.
      // It also settles a management flip (see `manageError`): the refusal IS
      // that switch's whole answer, so the section must release its in-flight
      // state on it — otherwise the control it disabled stays disabled forever.
      const seq = (state.manageError?.seq ?? 0) + 1;
      return {
        ...hint(state, `宿主提示：${action.message}`, 'warn'),
        manageError: { seq, message: action.message },
        historyPending: false,
        sessionsPending: false,
        trace: state.trace !== null ? { ...state.trace, pending: false } : null,
      };
    }
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
    qqbot: null,
    qqbotTest: null,
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
    // The workspace tree is the WORKSPACE's, not the session's, but a switch can
    // move the workspace too, and a tree drawn from the previous root would be
    // another directory's contents under this one's path. Dropping it makes the
    // panel ask again (the picker's own slot follows the same rule on open).
    tree: emptyTree,
    // Terminal commands are owned by a session on the host: keep this panel's
    // rows while the session is the same (a reconnect must not blank a running
    // command) and drop them when the reader switched.
    terminal: terminalForSession(state.terminal, info.sessionFile),
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

function hint(state: UiState, text: string, tone: 'info' | 'warn'): UiState {
  const seq = state.seq + 1;
  return { ...state, seq, blocks: [...state.blocks, { id: `b${seq}`, kind: 'hint', text, tone }] };
}