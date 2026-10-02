/**
 * The host→client half of the wire: every frame `server.ts` can send.
 *
 * Split from `protocol.ts` (which also owns the client→host frames and the
 * limits) because the two directions are separate contracts: a surface consumes
 * this one and produces the other, and a change to either is a change to one
 * half. `serializeServerFrame` stays in `protocol.ts`, where the constants and
 * the frame-name dispatch already are.
 *
 * This file is a pure payload surface: shapes only, no constants, no
 * validation. Every field is a fact the host decided (a count, a path, a
 * resolved view), never something the client is expected to derive.
 */
import type {
  ApprovalMode,
  ApprovalRequest,
  ConfiguredModel,
  ContextTimeline,
  DirectoryLevel,
  GitLogEntry,
  GitStatusEntry,
  JobSnapshot,
  KernelEvent,
  ModelCapabilities,
  ModelGroup,
  PtcMode,
  QuestionRequest,
  RunStats,
  TodoItem,
  Goal,
  ToolCallView,
  ToolResultView,
} from '@nova-agent/core';
import type { CommandSummary, ShellFamily } from '@nova-agent/plugins';
import type { WireRosterEntry } from './roster-entry.js';
import type { WireProviderRow } from './provider-wire.js';
import type { TermStatus } from './term-session.js';
import type { SessionTotals } from './totals.js';

export type ServerFrame =
  /**
   * A kernel event, verbatim, plus the **views** a surface needs to draw it.
   * The event stays the protocol's spine (a client that ignores the extra
   * fields still renders the stream); `view`/`resultView` are resolved
   * server-side from the live tool registry, so the browser never re-derives
   * per-tool render intent and third-party tools render from `generic`.
   */
  | { type: 'event'; event: KernelEvent; view?: ToolCallView; resultView?: ToolResultView }
  /** Everything a fresh client needs to rebuild the transcript. */
  | { type: 'ready'; info: ReadyInfo }
  /** One older slice of the replay baseline (answer to `load_earlier`). */
  | { type: 'history_earlier'; blocks: readonly WireBlock[]; total: number }
  | { type: 'sessions'; items: SessionListItem[] }
  /**
   * Workspace entries for the `@` menu (answer to `list_files`). `query` is
   * echoed so a client can drop a reply that arrived after it typed on, and
   * `truncated` says the walk hit its cap rather than the workspace ending.
   */
  | { type: 'files'; query: string; items: readonly WireFileEntry[]; truncated: boolean }
  /**
   * One listed directory level (answer to `list_directory`, and to a
   * `create_directory` that succeeded — creating a folder moves the picker into
   * it, so the reply states the level rather than making the browser ask
   * again). `error` carries a renderable reason when the level could not be
   * read; "cannot list" and "is empty" are different facts, so a refusal is
   * never an empty `entries`.
   */
  | ({ type: 'directory' } & WireDirectoryLevel)
  /** A `list_directory` / `create_directory` that the host refused. */
  | { type: 'directory_error'; message: string }
  /**
   * The answer to `pick_file` / `pick_directory`: what the host's native dialog
   * produced. Exactly one of three readings — `path` set means picked;
   * `error` set means the host has no dialog to open (fall back to the in-page
   * browser); neither set means the operator dismissed the dialog. Cancel and
   * unavailable are different facts and stay two spellings.
   */
  | { type: 'picked'; kind: 'file' | 'directory'; path?: string; error?: string }
  /** Session-level mode readout (after a switch, or when one is changed remotely). */
  | {
      type: 'state';
      approvalMode: ApprovalMode;
      codeMode: PtcMode;
      /** The id in force (what a switch retargets). */
      model: string;
      /** The surface's display name for it, when the catalog knows one. */
      modelName?: string;
    }
  /**
   * The model catalog (answer to `list_models`). `error` carries a renderable
   * reason when the endpoint could not be asked — the menu shows it beside a
   * Retry instead of an empty list, because "no models" and "could not ask"
   * are different facts.
   */
  | { type: 'models'; groups: readonly ModelGroup[]; current: string; error?: string }
  /**
   * The operator's editable model list, as stored (answer to `list_model_config`
   * and `save_models`).
   *
   * `models` empty means the key is absent from the file and the endpoint's
   * catalog is in charge — the page says exactly that instead of rendering "no
   * models", because the two are opposite facts.
   *
   * `published` and `automatic` exist so the page can be an EDITOR rather than a
   * viewer: `published` is what the endpoint serves (so an id the operator
   * removed can be added back), and `automatic[id]` is what models.dev reports
   * with no overrides (so an untouched field shows its real default as a
   * placeholder instead of looking empty). Both are computed host-side because
   * the override → automatic → unknown precedence is the host's rule to own.
   */
  | {
      type: 'model_config';
      models: readonly ConfiguredModel[];
      published: readonly string[];
      automatic: Readonly<Record<string, ModelCapabilities>>;
    }
  /**
   * The provider list, as stored (answer to `list_providers` / `save_providers`
   * / `set_provider`). Each row carries its baseURL and `hasApiKey`, never the key.
   *
   * `activeId` names the endpoint in force, and it is ABSENT when nothing is
   * configured — that absence is what the page renders as the first-run empty
   * shell, and it is a different state from "configured but none active".
   */
  | { type: 'providers'; providers: readonly WireProviderRow[]; activeId?: string }
  /**
   * The answer to `probe_provider`: the candidate endpoint's own catalog.
   *
   * Success carries the ids it published; failure carries a renderable reason.
   * Either way NOTHING was stored — the probe is the "填写完成后获取模型列表"
   * step that precedes choosing what to add, and a probe that wrote the config
   * would make an exploratory click a durable commitment.
   */
  | { type: 'provider_probe'; ok: boolean; baseURL: string; models: readonly string[]; message?: string }
  /**
   * One live plugin as the settings panel's plugins section lists it — the
   * kernel's own roster row (`Kernel.roster()`), word for word: name, fiber
   * state, injected services, plus the manager's `enabled` + `origin` (and the
   * plugin's own `description` when it declares one).
   */
  | { type: 'roster'; entries: readonly WireRosterEntry[]; configPath: string }
  /**
   * The plugin manager's rows (answer to a `set_plugin_enabled` flip): the
   * full roster as the panel draws it, plus the disable list now in force.
   */
  | { type: 'plugins'; entries: readonly WireRosterEntry[]; disable: readonly string[] }
  /**
   * The Skill 中心's rows (answer to `list_skills` / `set_skill_enabled`): the
   * discovered skills with their per-name switch state, plus the disable list
   * now in force.
   */
  | { type: 'skills'; items: readonly WireSkillEntry[]; disable: readonly string[] }
  /**
   * The qqbot connection snapshot (answer to `qqbot` / `save_qqbot`): what the
   * page may show without ever seeing the secret. `hasClientSecret` says one is
   * stored; `clientSecretRef` names the variable when the stored value is
   * exactly one `{env:NAME}` reference.
   */
  | {
      type: 'qqbot';
      appId?: string;
      hasClientSecret?: boolean;
      clientSecretRef?: string;
      /**
       * Why this plugin cannot connect right now, when the shell loaded its
       * config with an unresolved reference — a sentence to show as-is. Absent
       * means nothing is known to be wrong.
       *
       * It rides this snapshot rather than the `ready` baseline because it is a
       * fact about ONE plugin: the page that owns the plugin is the only place
       * it is actionable, and putting it on `ready` would make every client
       * carry a problem only one panel can render.
       */
      error?: string;
    }
  /**
   * The qqbot connection probe's answer (to `test_qqbot`): success carries the
   * gateway URL the credentials resolved to; failure carries the reason. Either
   * way nothing is stored.
   */
  | { type: 'qqbot_test'; ok: boolean; gateway?: string; message?: string }
  /**
   * A batch of trace rows: the newest `TRACE_TAIL` when `have` was 0, else the
   * batch immediately older than what the client holds. Rows arrive oldest
   * first within the batch, so a client concatenates and keeps one ordering.
   */
  | { type: 'trace'; rows: readonly WireTraceRow[]; total: number }
  /**
   * The 终端 tab's terminal: raw PTY bytes plus the pty's own state.
   *
   * Output is the shell's byte stream VERBATIM (ANSI included) — the browser
   * emulator interprets it, this surface never parses it. `reset: true` marks a
   * replay answer (a mount/reload rebuilds the emulator from the retained
   * scrollback: feed it, do not append). `status` / `exitCode` ride every frame
   * so a status change with no output still reaches an idle panel; `error` is
   * the spawn refusal itself (`unavailable`) — the terminal's own state, next
   * to the panel that asked for it.
   */
  | {
      type: 'term';
      /** PTY output bytes (or the replay); '' when nothing new arrived. */
      data: string;
      /** The emulator must clear before writing this data (a replay). */
      reset?: boolean;
      status: TermStatus;
      /** The pty's exit code, once it has one. */
      exitCode?: number;
      /** Why the terminal cannot be had right now (spawn refusal). */
      error?: string;
    }
  /**
   * The shells this host can start (the answer to `discover_shells`).
   *
   * Installed candidates only — a menu row that would fail to spawn is worse
   * than a shorter menu. `current` is the path a `term_open` with no choice
   * would start, so the panel's checkmark and its next terminal cannot disagree.
   */
  | {
      type: 'shells';
      items: readonly WireShell[];
      current: string;
    }
  /**
   * The Context panel's reading (answer to `context`, and the push that follows
   * each run's end and every roster flip). `null` is a REAL value — the plugin
   * that provides the reading is off, so the panel must clear itself and drop
   * its tab, not keep drawing a snapshot that stopped moving.
   */
  | { type: 'context'; timeline: ContextTimeline | null }
  /**
   * One file's content for the editor panel (answer to `read_entry`).
   *
   * `truncated` and `binary` are READINGS, not errors: an oversized or binary
   * file cannot be shown as text, and saying so is the honest answer — the
   * panel prints the reason instead of an empty editor claiming the file is
   * empty. `bytes` is the on-disk size either way.
   */
  | { type: 'entry'; path: string; text: string; bytes: number; truncated: boolean; binary: boolean }
  /** A `read_entry` the host could not perform (missing, outside the root). */
  | { type: 'entry_error'; path: string; message: string }
  /** A `write_entry` that landed; `bytes` is what the file now holds. */
  | { type: 'entry_saved'; path: string; bytes: number }
  /**
   * A structural change the panel must re-read: `dir` is the directory whose
   * listing changed (the reply every rename/remove/create answers with, so the
   * tree refreshes from state rather than from the click).
   */
  | { type: 'entry_changed'; change: 'renamed' | 'removed' | 'created'; path: string; dir: string }
  /**
   * The workspace's git status (answer to `git_status`, and the shape a
   * stage/unstage/commit re-answers with). `repo: false` means this workspace
   * is not a repository — the panel says so instead of drawing an empty list.
   */
  | {
      type: 'git_status';
      repo: boolean;
      branch: string;
      entries: readonly GitStatusEntry[];
      /**
       * The last operation's own line (`已提交 a1b2c3：…`, or why it failed).
       * Rides the state frame rather than a separate notice because the panel
       * must render it NEXT TO the refreshed list — a commit's evidence is the
       * index it emptied, and two frames could arrive out of order.
       */
      message?: string;
    }
  /**
   * One file's diff (answer to `git_diff`). `untracked: true` marks a file git
   * has no diff for at all — the panel renders the file's own text as an
   * all-new diff, which is what "this file is entirely new" looks like.
   */
  | { type: 'git_diff'; path: string; staged: boolean; text: string; truncated: boolean; untracked: boolean }
  /** Recent commits (answer to `git_log`). */
  | { type: 'git_log'; entries: readonly GitLogEntry[] }
  /**
   * The live session's background jobs (answer to `list_jobs`), in start
   * order. Read-only: output is the model's cursor and a panel must not drain
   * it, so a row carries the sampled `progress` line and nothing consumable.
   */
  | { type: 'jobs'; items: readonly WireJobRow[] }
  | { type: 'error'; message: string };

/**
 * One Skill 中心 row: the discovery's own name/description/source (see the
 * kernel's `SkillMetadata`) plus its switch state. `source` is `project` for the
 * workspace's own roots (`<root>/.agents/skills/` first, then the legacy
 * `<root>/.nova/skills/`) and `user` for the home roots (`~/.agents/skills/`
 * first, then the legacy `~/.nova/skills/`) — the cross-tool `.agents` standard
 * leads at each level, and `.nova` is kept as the compatible second root.
 */
/**
 * One shell the host can start — a row of the `shells` answer.
 *
 * `path` is what a `term_open` sends back to choose this row; `family` is a
 * label only, because the host owns the argument table.
 */
export interface WireShell {
  name: string;
  path: string;
  family: ShellFamily;
}

export interface WireSkillEntry {
  name: string;
  description: string;
  source: string;
  enabled: boolean;
}

/**
 * One durable event as the trace view lists it. Shape only — every row's
 * wording belongs to the surface (see `ui/src/trace-view.ts`), which is why
 * these variants carry facts (a role, a count, an outcome) and no prose.
 */
export type WireTraceRow =
  | {
      kind: 'message';
      ts: number;
      role: 'user' | 'assistant' | 'tool' | 'other';
      /** The message's first non-empty line, bounded server-side. */
      preview: string;
      /** Tool calls the assistant message carries (0 for every other role). */
      tools: number;
      /** The tool a result message came from. */
      name?: string;
      /** The seeded session-start context fragment (nobody typed this message). */
      context?: true;
    }
  | {
      kind: 'compaction';
      ts: number;
      phase: 'start' | 'summary' | 'end';
      trigger?: 'auto' | 'manual';
      /** Tokens the summary replaced (the summary phase). */
      tokens?: number;
      error?: string;
    }
  | { kind: 'todo'; ts: number; total: number; open: number }
  | { kind: 'approval'; ts: number; tool: string; request: string; outcome: 'allow' | 'deny' | 'always' }
  | { kind: 'workspace'; ts: number; path: string }
  | { kind: 'dispatch'; ts: number; tool: string; isError: boolean }
  /**
   * One run's measurement row (the same numbers the transcript's meta line
   * shows). The log is where they live; the trace reads the log.
   */
  | { kind: 'run'; ts: number; stats: RunStats }

/** One renderable transcript entry (see `transcript.ts` for the projection). */
export type WireBlock =
  /**
   * `ts` is the log's own timestamp — the message row's clock on replay.
   *
   * `images` carries the REFERENCES to images this prompt attached, so a reload
   * can re-fetch the bytes from the id-addressed route. Only the id and media
   * type cross here: the pixels are fetched lazily by the browser, so an
   * attachment costs the transcript wire nothing until it is drawn.
   */
  | {
      kind: 'user';
      text: string;
      ts?: number;
      images?: readonly { id: string; mediaType: string }[];
    }
  | { kind: 'text'; text: string; ts?: number }
  /**
   * A turn the user cut short. The log carries a synthetic `user` message for
   * the model (`isAbortMarker`) — that text is model-facing scaffolding, so it
   * crosses the wire as this copy-free marker and each surface words it.
   */
  | { kind: 'aborted' }
  /**
   * One finished run's measurement, anchored to the message it closed. The
   * kernel measured these numbers once (they are the only per-turn facts a
   * reader cannot re-derive from the messages), so the row is projected from
   * the log like any other block: a resumed session shows the same line a live
   * one did, and no surface has to time anything itself.
   */
  | { kind: 'meta'; stats: RunStats; ts: number }
  /**
   * One section of the seeded session-start context fragment. The tag names
   * which producer contributed it, the form is the body shape `core` read off
   * that section's own syntax (name/value rows for the environment, entries for
   * the skills index, otherwise its bytes) — a surface draws the form, and the
   * text is always the model-facing bytes.
   */
  | {
      kind: 'context';
      tag: string;
      form: 'snapshot' | 'catalog' | 'text';
      sections?: readonly { name: string; text: string }[];
      entries?: readonly { name: string; description: string }[];
      /** The catalog form's non-entry lines (its closing prose), when any. */
      note?: string;
      text: string;
    }
  | {
      kind: 'tool';
      callId: string;
      name: string;
      args: string;
      view: ToolCallView;
      /** Timestamp of the call (log `ts` on replay) — the transcript's clock. */
      ts?: number;
      /** Absent while the call is still running (or if the run died mid-call). */
      result?: ToolResultView;
      /**
       * The tool's result text, for the detail panel. The model-facing message
       * is already size-bounded (~40KB, oversized output spills to disk), so
       * this needs no cap of its own.
       */
      output?: string;
    };

export interface ReadyInfo {
  rootDir: string;
  sessionFile: string;
  /**
   * The running version, as the owning shell reports it (`ready` is the one
   * frame every client receives, so the hero's badge names the build without
   * a second endpoint). Absent → the surface keeps its static badge.
   */
  version?: string;
  /** The model id in force. */
  model: string;
  /** The surface's display name for it (the trigger's label when it has one). */
  modelName?: string;
  approvalMode: ApprovalMode;
  codeMode: PtcMode;
  /**
   * The NEWEST slice of the durable log's projection — the replay baseline.
   * Older blocks are fetched with `load_earlier`; `historyTotal` says how many
   * there are in all, so the client can show what it has not loaded yet.
   */
  history: readonly WireBlock[];
  /** Total blocks in the baseline (`history` is its tail). */
  historyTotal: number;
  /**
   * The session's totals as the WHOLE log reports them (every run it ever
   * recorded, not just the blocks this frame carries). A resumed session's
   * stats bar starts here and grows with each live `run_stats`.
   */
  runTotals: SessionTotals;
  /**
   * How many rows the durable event log holds. The trace view's pages come from
   * `load_trace`; this number is what lets its pane say how much is not loaded
   * yet without fetching anything.
   */
  traceTotal: number;
  /** Approval requests still outstanding (re-render the modal after reload). */
  pendingApprovals: readonly ApprovalRequest[];
  /**
   * Question requests still outstanding — same rule as `pendingApprovals`, and
   * load-bearing for a different reason: the run is SUSPENDED inside the ask, so
   * a reattaching client that did not receive this would show an idle session
   * with no way to answer and no way to abort it.
   */
  pendingQuestions: readonly QuestionRequest[];
  /**
   * Background jobs the kernel still knows about — a reconnect rebuilds its
   * live job rows from these instead of losing them with the old socket.
   */
  jobs: readonly JobSnapshot[];
  /** Prompt tokens of the last request — the context gauge's numerator. */
  usedTokens: number;
  /** Model context window, when known (config or models.dev); the denominator. */
  contextWindow?: number;
  /**
   * Whether this kernel can switch models at all (a retargetable client plus a
   * catalog). False means the seat renders as inert text rather than a control
   * that would open onto nothing.
   */
  modelSwitching: boolean;
  /**
   * The kernel's own command catalog (name + description), for the composer's
   * `/` menu. It comes from the live registry, so a plugin's command appears
   * here without a surface change; commands that need a surface affordance live
   * with their surface and are not in this list.
   */
  commands: readonly CommandSummary[];
  /**
   * The model's current plan (the last `todo_write` snapshot), absent when it
   * never wrote one. Read from the log, so a resume or reconnect restores the
   * panel instead of waiting for the next write.
   */
  todos?: readonly TodoItem[];
  /**
   * The goal in force, or `null` when there is none. Read from the log like
   * `todos`, so a resume restores the goal panel rather than waiting for the next
   * change. Always sent (unlike the optional `todos`, where absence is meaningful)
   * because "no goal" and "cleared" are the same state here.
   */
  goal?: Goal | null;
  /**
   * The live plugin roster at attach time, in the same row shape the `roster`
   * frame carries. Sent as a BASELINE because the settings nav derives which
   * pages exist from it: the `roster` frame is only asked for by the plugins
   * panel, so a client that opened 设置 first (the cold-start case, right after
   * a restart) had no row for a plugin the operator had switched OFF and drew
   * its page anyway — the reported 「关掉 QQ BOT 后它仍在设置页显示」.
   *
   * Optional: a host that predates this field simply omits it, and the nav
   * then falls back to the flip answers it does receive.
   */
  roster?: readonly WireRosterEntry[];
  /**
   * The Context panel's baseline: the session's context reading as of attach.
   * Absent when the `context` plugin is off — the panel has no tab to draw, and
   * the first `context` frame (or `ready` after a switch) states it. Sent on
   * `ready` rather than fetched because the tab's first paint must not wait for
   * a request.
   */
  context?: ContextTimeline;
  /** Where the config the switches write lives; names the roster's source. */
  configPath?: string;
}

/**
 * One workspace entry the `@` menu can offer. `path` is workspace-relative with
 * `/` separators (the form the reference grammar writes into a draft), so the
 * browser never has to re-derive a separator from a host-native path.
 */
export interface WireFileEntry {
  /** Workspace-relative path, `/`-separated (what `@` inserts). */
  path: string;
  /** Last path segment (the row's label). */
  name: string;
  kind: 'file' | 'directory';
}

/**
 * One directory level as the picker receives it: core's `DirectoryLevel`
 * straight across the wire. A named alias rather than a re-declared shape, so
 * the host's enumeration and the browser's drawing cannot drift apart.
 */
export type WireDirectoryLevel = DirectoryLevel;

export interface SessionListItem {  /** Absolute path of the JSONL log (the `resume` frame's only accepted form). */
  file: string;
  /** First real user prompt, single line; '' when the log has none. */
  title: string;
  mtime: number;
  /**
   * The workspace the session was created in. The sessions dir is global (every
   * project's logs share the same date buckets), so this is the only thing that
   * tells two projects' sessions apart; absent when the log head carries
   * neither a workspace marker nor a `cwd=` line.
   */
  workspace?: string;
}

/**
 * One background job as the tasks panel lists it.
 *
 * Deliberately WITHOUT output: `JobRegistry.readOutput` is a consuming cursor
 * move (the model's `jobs` tool reads through it), so a panel that drained it
 * would eat the model's output. The one-line `progress` sample is the peek
 * designed for live rows, and it is what this row carries.
 */
export interface WireJobRow {
  id: string;
  kind: string;
  label: string;
  status: string;
  detail?: string;
  startedAt?: number;
  progress?: string;
}

/** One host frame per WS text message. */
