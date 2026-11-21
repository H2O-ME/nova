/**
 * The UI state's type vocabulary: the transcript's blocks, the frame-level
 * slices, and the state object itself. Kept apart from the reducer so a reader
 * looking for "what a field means" does not have to scroll through 400 lines of
 * switch cases — and so the reducer's size is not inflated by declarations.
 */
import type {
  ApprovalMode, ApprovalRequest, CommandSummary, ConfiguredModel, ContextTimeline,
  Goal, GitStatusEntry, JobSnapshot, ModelCapabilities, ModelGroup,
  QuestionRequest, ReadyInfo, RunStats, SessionListItem, SubagentUsage, TodoItem,
  ToolCallView, ToolResultView, TurnPhase, WireDirectoryLevel, WireFileEntry,
  WireProviderRow, WireRosterEntry, WireSkillEntry, WireTraceRow,
} from '../types.js';
import type { TreeState } from '../rightbar/files-model.js';
import type { EditorState } from '../rightbar/editor-model.js';
import type { SessionTotals } from '@nova-agent/core/totals';

export type { SessionTotals };

export type Block =
  | {
      id: string;
      kind: 'user';
      text: string;
      /** The log's timestamp (the row's clock). */
      ts?: number;
      /**
       * Images this prompt attached, by reference. The pixels are fetched by
       * frame when the row draws (`fetchImageBytes`), never carried in the
       * transcript: a reload must show the attachment the conversation actually
       * had, and the bytes live in the store, not in the frame.
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
  /**
   * A prompt/command the browser just put on the socket has NOT been echoed by
   * the kernel yet (`user_message` / command `run` row). `submit()` clears the
   * draft optimistically; this is what makes the clearing provisional — and
   * {@link sendRejected} is the bell it rings.
   */
  awaitingEcho: boolean;
  /**
   * How many sends were refused (an `error` frame arrived before any echo).
   * A counter, not a boolean: two rejections — even of the same text — are two
   * observable events, and the composer restores the draft on each it sees.
   */
  sendRejected: number;
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
   * The workspace's git status (null until asked), used only to decorate the
   * file tree. `repo: false` is a reading, not an error: the workspace simply
   * is not a repository.
   */
  git: GitState | null;
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

/** The file tree's git decorations: the working tree as last read. */
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
  /** The session-TITLE model (config `titleModel`); `null` when unset. */
  titleModel: string | null;
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
