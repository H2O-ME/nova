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
 * Frame-level bookkeeping (attach, pagination, host errors) lives in
 * this file; one case per kernel event lives next door in `state-events.ts`.
 */
import type {
  ApprovalMode, ApprovalRequest, ClientFrame, CommandSummary, ConfiguredModel, ContextTimeline, GitLogEntry, Goal, GitStatusEntry, JobSnapshot, KernelEvent, ModelCapabilities, ModelGroup, QuestionRequest, ReadyInfo,
  RunStats, SessionListItem, SubagentUsage, TodoItem, ToolCallView, ToolResultView, TurnPhase, WireBlock,
  WireDirectoryLevel, WireFileEntry, WireJobRow, WireProviderRow, WireRosterEntry, WireShell, WireSkillEntry, WireTraceRow,
} from './types.js';
import { reduceEvent } from './state-events.js';
import { hostErrorText } from './host-messages.js';
import { treeAsk, treeError, treeLevel, emptyTree, type TreeState } from './rightbar/files-model.js';
import { applyTerm, emptyTerm, termForSession, type TermFrame, type TermState } from './rightbar/terminal-model.js';
import { closeDoc, docError, docLoaded, emptyEditor, openDoc,
  type EditorState,
} from './rightbar/editor-model.js';

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
   * Why the last management request (a plugin or skill switch) was refused, or null when nothing is outstanding. A refusal arrives
   * as an `error` frame, NOT as a fresh snapshot — so a section waiting on "the
   * next answer settles my in-flight control" would wait forever, leaving that
   * control disabled. This is that missing signal.
   *
   * Bumped on every error (a counter, not a flag) so a second refusal of the
   * same text is still a change the sections can observe.
   */
  manageError: { readonly seq: number; readonly message: string } | null;
  /**
   * Every plugin operation's answer, keyed by `plugin` and then by the
   * correlation id the browser sent.
   *
   * One map for every plugin, because the browser does not know what any of them
   * are: a page renders its own answer and nothing else. Entries are dropped when
   * a later answer for the same plugin supersedes them, so the map cannot grow
   * with every click.
   */
  pluginAnswers: Readonly<Record<string, PluginRequestAnswer | undefined>>;
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
   * session state: it is not logged and not sent anywhere. It follows ONE
   * session — a switch resets it to the conversation (a carried view draws
   * the new session's pane under the hero), while a re-attach to the same
   * session keeps it (a reconnect must not kick the reader out of the pane
   * they were reading).
   */
  view: SessionViewId;
  /**
   * The trace view: rows as of its last read, plus how many the log holds. Null
   * until the view is first opened — the log is read on demand, because most
   * visits never leave the conversation.
   */
  trace: TraceState | null;
  /**
   * The Context panel's reading, or null when the plugin is off (the `context`
   * frame answers null and the panel then has no tab to draw). Present only when
   * the panel is open enough to be worth paying for the walk — see `ContextView`.
   */
  context: ContextTimeline | null;
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
  /** A native-dialog pick (`pick_file` / `pick_directory`) is in flight. */
  pickPending: boolean;
  /** A `git_clone` is in flight (the answer is a new `ready`, not a frame). */
  clonePending: boolean;
  /**
   * The last `picked` frame, or null. Kept here (not in a component) because
   * the ask and its answer are frames and the reducer is what sees both.
   */
  pick: PickReply | null;
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
   * The right panel's editor: the open documents and the one on screen. Reads
   * are asked for here and settled by the host's `entry` / `entry_error`
   * frames, so the panel and the reply cannot disagree about what is loaded —
   * `rightbar/editor-model.ts` owns the fold.
   */
  editor: EditorState;
  /**
   * The 变更 tab's git lens (null until asked). `repo: false` is a reading,
   * not an error: the workspace simply is not a repository.
   */
  git: GitState | null;
  /**
   * The 任务 tab's jobs (null until asked). Read-only rows: output is the
   * model's consuming cursor, so this slice carries status and the sampled
   * progress line only.
   */
  jobs: readonly WireJobRow[] | null;
  /**
   * The right panel's terminal: the SESSION's real PTY, as this browser last
   * saw it. Output is a raw byte stream the emulator consumes, so this slice
   * only carries status, the exit code and the owed byte batch — see
   * `rightbar/terminal-model.ts`.
   */
  term: TermState;
  /**
   * The host's shell inventory (null until asked). The rows are what the
   * terminal's picker offers — installed only, the environment's default first —
   * and `current` is the row a choiceless open would start.
   */
  shells: { items: readonly WireShell[]; current: string } | null;
  /** Cumulative run numbers for the stats bar (session-scoped, like the kernel's). */
  totals: SessionTotals;
}

/** The session pane's view ids. `context` appears (and its tab renders) only while the panel has a reading — see the reducer's `context` handling. */
export type SessionViewId = 'chat' | 'trace' | 'context';

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

/**
 * One plugin operation's answer, as the page that asked reads it.
 *
 * `pending` exists so a control can disable itself while its own request is in
 * flight without the panel tracking a request per control: the section sends, the
 * reducer parks the ask, the answer replaces it.
 */
export interface PluginRequestAnswer {
  readonly id: number;
  readonly op: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly pending?: boolean;
}

/** One file's diff as the 变更 tab shows it. */
export interface GitDiffState {
  path: string;
  /** Whether this is the index side. */
  staged: boolean;
  text: string;
  truncated: boolean;
  /** Git has no diff for this file (untracked): the panel renders it as new. */
  untracked: boolean;
}

/** The 变更 tab's git lens: the working tree, the selected diff, the log. */
export interface GitState {
  /**
   * The workspace root this answer was read in.
   *
   * The rows are repo-relative, so a reading from another root would decorate
   * this tree with another repository's status — and nothing in the frames
   * carries the root, so the reducer stamps it from the state it answered in.
   */
  root: string;
  repo: boolean;
  branch: string;
  entries: readonly GitStatusEntry[];
  /** The last operation's own line (a commit's summary, or why it failed). */
  message?: string;
  /** The diff on screen, when one was asked for. */
  diff: GitDiffState | null;
  /** Recent commits, when asked for (newest first). */
  log: readonly GitLogEntry[];
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
 * One native-dialog pick's answer (`picked` frame), held for App to consume:
 * a path adopts a workspace or rails a file, an error falls back to the
 * in-page browser, and neither means the dialog was dismissed.
 */
export interface PickReply {
  kind: 'file' | 'directory';
  path?: string;
  error?: string;
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
  model: '',
  modelName: null,
  modelSwitching: false,
  catalog: null,
  roster: null,
  plugins: null,
  skills: null,
  manageError: null,
  pluginAnswers: {},
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
  context: null,
  files: null,
  directory: null,
  pickPending: false,
  clonePending: false,
  pick: null,
  tree: emptyTree,
  editor: emptyEditor(),
  git: null,
  jobs: null,
  term: emptyTerm,
  shells: null,
  totals: emptyTotals,
};

export type Action =
  | { type: 'connection'; connected: boolean }
  /** A frame the client just put on the socket — request-side state the
   *  server's replies alone cannot account for (the pagination in-flight flag). */
  | { type: 'sent'; frame: ClientFrame }
  | { type: 'ready'; info: ReadyInfo }
  | { type: 'event'; event: KernelEvent; view?: ToolCallView; resultView?: ToolResultView }
  | { type: 'state'; approvalMode: ApprovalMode; model: string; modelName?: string }
  | { type: 'models'; groups: readonly ModelGroup[]; current: string; error?: string }
  | { type: 'roster'; entries: readonly WireRosterEntry[]; configPath: string }
  | { type: 'plugins'; entries: readonly WireRosterEntry[]; disable: readonly string[] }
  | { type: 'skills'; items: readonly WireSkillEntry[]; disable: readonly string[] }

  | { type: 'model_config'; models: readonly ConfiguredModel[]; published: readonly string[]; automatic: Readonly<Record<string, ModelCapabilities>> }
  | { type: 'providers'; providers: readonly WireProviderRow[]; activeId?: string }
  /** The host's answer to `probe_provider` (success or reason), same shape. */
  | { type: 'provider_probe'; baseURL: string; ok: boolean; models: readonly string[]; message?: string }
  /**
   * One plugin operation's answer. `pending` marks the browser's own ask so a
   * control can disable itself while its request is in flight.
   */
  | {
      type: 'plugin_answer';
      plugin: string;
      id: number;
      op: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  /**
   * The browser asked a plugin for something: recorded IMMEDIATELY so the page's
   * own control can disable itself while the answer is in flight, without the
   * panel tracking a request per control. The answer (`plugin_answer`) replaces
   * it, keyed by the same plugin — a page that has several requests in flight
   * only ever needs its latest answer.
   */
  | { type: 'plugin_ask'; plugin: string; id: number; op: string }
  /**
   * The operator edited a field on a plugin's page: whatever the last ACTION
   * answered no longer describes what is on screen (a probe result belongs to the
   * exact text it tested). The `page` descriptor is kept — dropping it would
   * blank the form the operator is typing into.
   */
  | { type: 'plugin_edit' }
  | { type: 'sessions'; items: readonly SessionListItem[] }
  | { type: 'files'; query: string; items: readonly WireFileEntry[]; truncated: boolean }
  | { type: 'directory'; level: WireDirectoryLevel }
  | { type: 'directory_error'; message: string }
  /** The host's native dialog answered (`picked` frame). */
  | { type: 'picked'; kind: 'file' | 'directory'; path?: string; error?: string }
  /**
   * One `term` frame from the right panel's terminal: raw pty bytes plus the
   * pty's own state. The fold lives in `rightbar/terminal-model.ts` — the
   * reducer only routes it to the slice.
   */
  | { type: 'term'; frame: TermFrame }
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
  | { type: 'context'; timeline: ContextTimeline | null }
  /** One file's content settled a read (the answer to `read_entry`). */
  | { type: 'entry'; path: string; text: string; bytes: number; truncated: boolean; binary: boolean }
  /** A read the host refused; the document stays open showing the reason. */
  | { type: 'entry_error'; path: string; message: string }
  /**
   * A structural change (rename/remove/create): the directory it happened in is
   * marked for re-listing, so the tree refreshes from an answer rather than
   * from the click — the panel's own `needsListing` effect picks the ask up.
   */
  | { type: 'entry_changed'; change: 'renamed' | 'removed' | 'created'; path: string; dir: string }
  /** The workspace's git status (also the answer to every git mutation). */
  | { type: 'git_status'; repo: boolean; branch: string; entries: readonly GitStatusEntry[]; message?: string }
  /** One file's diff, as asked. */
  | { type: 'git_diff'; path: string; staged: boolean; text: string; truncated: boolean; untracked: boolean }
  /** Recent commits. */
  | { type: 'git_log'; entries: readonly GitLogEntry[] }
  /** The 任务 tab's rows. */
  | { type: 'jobs'; items: readonly WireJobRow[] }
  /** The host's shell inventory (the answer to `discover_shells`). */
  | { type: 'shells'; frame: { items: readonly WireShell[]; current: string } }
  /** The user closed a file tab (the tab is the strip's; the doc leaves too). */
  | { type: 'editor_close'; path: string }
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
        // A dropped socket cannot deliver the `picked` reply either.
        pickPending: action.connected ? state.pickPending : false,
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
      if (action.frame.type === 'read_entry') {
        // The document enters the editor the moment the read goes OUT (it
        // renders as loading); the host's `entry` / `entry_error` then settles
        // the doc that is already there. Opening it here, on the request, is
        // what gives the gesture one owner: every caller of `read_entry` — the
        // tree row, its kebab menu, anything later — gets an open document,
        // and an answer for a path nobody asked about still cannot conjure one.
        return { ...state, editor: openDoc(state.editor, action.frame.path) };
      }
      if (action.frame.type === 'git_clone') {
        // A clone can take a network's worth of seconds; the flag rides the
        // request so the button says so. It settles on the `ready` the host
        // broadcasts after adopting the clone (applyReady) or on the `error`
        // frame a failed clone answers with — both are replies.
        return { ...state, clonePending: true };
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
      // The native-dialog ask marks itself in flight: the guard against a second
      // dialog reads it, and only the `picked` reply (or a disconnect) settles it.
      if (action.frame.type === 'pick_file' || action.frame.type === 'pick_directory') {
        return { ...state, pickPending: true };
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
    case 'plugin_answer': {
      const answer: PluginRequestAnswer = {
        id: action.id,
        op: action.op,
        ok: action.ok,
        ...(action.result !== undefined ? { result: action.result } : {}),
        ...(action.error !== undefined ? { error: action.error } : {}),
      };
      return { ...state, pluginAnswers: { ...state.pluginAnswers, [action.plugin]: answer } };
    }
    case 'plugin_edit': {
      // Only ACTION answers are dropped: `page` describes the plugin and stays
      // until the plugin itself replaces it.
      const kept: Record<string, PluginRequestAnswer | undefined> = {};
      for (const [plugin, answer] of Object.entries(state.pluginAnswers)) {
        if (answer !== undefined && answer.op === 'page') kept[plugin] = answer;
      }
      return { ...state, pluginAnswers: kept };
    }
    case 'plugin_ask': {
      const answer: PluginRequestAnswer = { id: action.id, op: action.op, ok: false, pending: true };
      return { ...state, pluginAnswers: { ...state.pluginAnswers, [action.plugin]: answer } };
    }
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
      // Only the open picker can be mid-ask (its own effect is the only caller):
      // a null slot stays null, so no path can conjure the dialog into being.
      return {
        ...state,
        directory: state.directory === null ? null : {
          level: state.directory.level ?? null,
          error: null,
          pending: true,
          mode: state.directory.mode,
        },
      };
    case 'directory':
      // The error clears because a level DID arrive: the previous refusal was
      // about a different path. The same answer feeds the right panel's tree
      // (keyed by the host's own absolute path): one frame, two readers, and no
      // second ask — the picker and the panel may both have one in flight.
      //
      // **The picker's slot is only written while the picker is OPEN.** The tree
      // asks these same frames for its own levels, and filling the slot from an
      // answer is what made the dialog appear out of nowhere: opening the right
      // panel (whose 文件 page asks for the workspace root) drew 「选择工作区文件夹」
      // over a session that already had a workspace — the reported 「文件页面居然
      // 需要我再选择一遍」. A dialog is opened by a GESTURE (`directory_open`), never
      // by an answer to somebody else's question.
      return {
        ...state,
        tree: treeLevel(state.tree, action.level),
        directory: state.directory === null ? null : {
          level: action.level,
          error: null,
          pending: false,
          mode: state.directory.mode,
        },
      };
    case 'directory_error':
      // The previous level is kept: a failed navigation returns the user to
      // where they were with the reason stated, not to a blank dialog. The tree
      // marks whatever it was waiting for as refused (the frame carries no path;
      // see `files-model.treeError`). Same rule as the answer above: a refusal
      // for the tree's own ask must not open the picker.
      return {
        ...state,
        tree: treeError(state.tree, action.message),
        directory: state.directory === null ? null : {
          level: state.directory.level,
          error: action.message,
          pending: false,
          mode: state.directory.mode,
        },
      };
    case 'picked': {
      const { type: _picked, ...reply } = action;
      return { ...state, pickPending: false, pick: reply };
    }
    case 'term':
      return { ...state, term: applyTerm(state.term, action.frame) };
    case 'entry':
      return { ...state, editor: docLoaded(state.editor, action) };
    case 'entry_error':
      return { ...state, editor: docError(state.editor, action.path, action.message) };
    case 'entry_changed': {
      // The change happened in one directory; marking that level as needing a
      // fresh read is the whole update — the panel's own effect asks, and the
      // answer (a `directory` frame) is what the tree renders from. A removed
      // OPEN document is closed too: its rows would otherwise sit on a file
      // that no longer exists.
      const editor = action.change === 'removed' ? closeDoc(state.editor, action.path) : state.editor;
      return { ...state, editor, tree: treeAsk(state.tree, action.dir) };
    }
    case 'git_status':
      return {
        ...state,
        git: {
          root: state.meta?.rootDir ?? '',
          repo: action.repo,
          branch: action.branch,
          entries: action.entries,
          ...(action.message !== undefined ? { message: action.message } : {}),
          // A refreshed status keeps the diff on screen ONLY while its file is
          // still changed: a committed (or reverted) file's stale diff would
          // claim work that is no longer pending.
          diff: state.git?.diff !== null && state.git !== null
            && action.entries.some((entry) => entry.path === state.git?.diff?.path)
            ? state.git.diff
            : null,
          log: state.git?.log ?? [],
        },
      };
    case 'git_diff':
      return state.git === null
        ? state
        : { ...state, git: { ...state.git, diff: { path: action.path, staged: action.staged, text: action.text, truncated: action.truncated, untracked: action.untracked } } };
    case 'git_log':
      return state.git === null
        ? state
        : { ...state, git: { ...state.git, log: action.entries } };
    case 'jobs':
      return { ...state, jobs: action.items };
    case 'shells':
      return { ...state, shells: action.frame };
    case 'editor_close':
      return { ...state, editor: closeDoc(state.editor, action.path) };
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
    case 'context':
      // A null reading is REAL: the plugin is off, so the panel must drop its
      // tab (a view stuck on `context` would draw a pane with no data). When the
      // panel is not in front, the reading is still kept — the tab shows the
      // composition as a strip until it is opened.
      return {
        ...state,
        context: action.timeline,
        ...(action.timeline === null && state.view === 'context' ? { view: 'chat' } : {}),
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
        ...hint(state, hostErrorText(action.message), 'warn'),
        manageError: { seq, message: action.message },
        historyPending: false,
        sessionsPending: false,
        clonePending: false,
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
    // The terminal is owned by a session on the host: keep this panel's state
    // while the session is the same (a reconnect must not blank a running
    // shell) and drop it when the reader switched.
    term: termForSession(state.term, info.sessionFile),
    // The git reading is the WORKSPACE's, and it is stamped with the root it
    // answered for (`GitState.root`): a session switch may move the workspace,
    // and rows from the previous root would decorate this tree with another
    // repository's status. Dropping it makes the panel ask again.
    git: null,
    // Background jobs belong to the session that started them (the host keys
    // them by session id), so a switch drops the rows rather than showing
    // another session's work.
    jobs: null,
    // The re-baseline IS the clone's success reply (the host adopts the clone
    // and restates the surface), so an in-flight clone settles here too —
    // `error` covers the failed direction.
    clonePending: false,
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