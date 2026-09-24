/**
 * The wire contract between browser and host (M11 批2): JSON frames over one
 * WebSocket, one frame per message. Client frames are the ONLY way anything
 * mutates the kernel (prompt/abort/answer/compact/switch); host frames are
 * the kernel event stream plus list/replay answers.
 *
 * This module owns the shapes and the constants that bound them; the inbound
 * validator lives in `client-frame.ts` (it is the untrusted-input path, and it
 * is long enough to be read on its own).
 */
import type {
  ApprovalMode,
  ApprovalRequest,
  AskResult,
  JobSnapshot,
  KernelEvent,
  ModelGroup,
  PtcMode,
  RunStats,
  ToolCallView,
  ToolResultView,
} from '@nova-agent/core';
import type { CommandSummary } from '@nova-agent/plugins';
import type { SessionTotals } from './totals.js';

/** Mode vocabularies are core's (the config schema and the engine speak them). */
export type { ApprovalMode, PtcMode };
/** The command catalog's row shape is the kernel assembly's (`Kernel.commands`). */
export type { CommandSummary } from '@nova-agent/plugins';
/** The model catalog's shapes are core's too (the picker's contract). */
export type { ModelGroup, ModelOption } from '@nova-agent/core';

/** Max bytes of one inbound text frame (prompt bodies are user-typed, not tool dumps). */
export const MAX_CLIENT_FRAME_BYTES = 512 * 1024;
/** Max chars of a prompt — generous for pasted stack traces, far below frame size. */
export const MAX_PROMPT_CHARS = 200_000;
/**
 * Max chars of a model id (an endpoint's own id; no id is anywhere near this).
 */
export const MAX_MODEL_CHARS = 200;
/** Max chars of a slash-command name (kernel commands are short ASCII words). */
export const MAX_COMMAND_NAME_CHARS = 64;
/** Max chars of a command's argument line (a skill name, a path — not a document). */
export const MAX_COMMAND_ARGS_CHARS = 2000;
/**
 * Blocks the replay baseline keeps out of one `ready` frame, and the size of
 * each older batch. A session's history is unbounded; the attach payload is not.
 */
export const HISTORY_TAIL = 40;

/**
 * Rows one trace page carries. The trace's unit is an event, not a rendered
 * block, so a long session has several times more rows than blocks — the page
 * is smaller for the same reason the payload must stay bounded.
 */
export const TRACE_TAIL = 30;
/** Upper bound for the client's `have` cursor (a guard, not a real limit). */
export const MAX_HISTORY_BLOCKS = 1_000_000;

/**
 * A `resolve_approval` answer. The browser sends either shape — a bare verdict,
 * or a grant carrying `{reason}` / `{scopeWords}` — and core's `parseAskResult`
 * turns it into the kernel's `AskResult` before the frame ever reaches a session.
 */
export type ClientFrame =
  | { type: 'prompt'; text: string }
  | { type: 'abort' }
  | { type: 'resolve_approval'; id: string; answer: AskResult }
  | { type: 'compact' }
  /**
   * Run one kernel command (the catalog `ready.commands` publishes). Sent when
   * the user submits a `/name args` draft: the same registry the TUI's panel
   * reads, so one registration serves every surface. Reporting rides the event
   * stream (`command` events → transcript rows), not this frame's return.
   */
  | { type: 'command'; name: string; args: string }
  | { type: 'list_sessions' }
  | { type: 'resume'; file: string }
  | { type: 'new_session' }
  | { type: 'set_approval_mode'; mode: ApprovalMode }
  | { type: 'set_code_mode'; mode: PtcMode }
  /**
   * Load the model catalog. Sent when the seat's menu opens (and by its Retry):
   * the endpoint is asked on demand rather than at boot, so a slow or
   * unreachable gateway delays a menu instead of the first paint.
   */
  | { type: 'list_models' }
  /**
   * Switch the model in force. The kernel retargets the one live client and
   * announces a `model` event, so that event — not this frame's return — is
   * what the control renders; a pick the endpoint refuses surfaces as an error
   * frame instead of a silent no-op.
   */
  | { type: 'set_model'; model: string }
  /**
   * Ask a background job to stop. The kernel answers with `job_update` frames
   * (`stopping` → `killed`), so the control and its acknowledgement ride the
   * same channel as every other job transition.
   */
  | { type: 'stop_job'; id: string }
  /**
   * Page back through the replay baseline: `have` is how many baseline blocks
   * the client already holds (counting from the NEWEST), the host answers with
   * the batch immediately older than them. A long session therefore attaches
   * with a bounded payload instead of its whole history.
   */
  | { type: 'load_earlier'; have: number }
  /**
   * Page back through the session's durable event log (the 轨迹 view): `have` is
   * how many rows the client already holds (counting from the NEWEST). The log
   * is the append-only truth behind the transcript, so this is a read of it,
   * not of anything the kernel keeps in memory.
   */
  | { type: 'load_trace'; have: number };

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
   * A batch of trace rows: the newest `TRACE_TAIL` when `have` was 0, else the
   * batch immediately older than what the client holds. Rows arrive oldest
   * first within the batch, so a client concatenates and keeps one ordering.
   */
  | { type: 'trace'; rows: readonly WireTraceRow[]; total: number }
  | { type: 'error'; message: string };

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
  /** `ts` is the log's own timestamp — the message row's clock on replay. */
  | { kind: 'user'; text: string; ts?: number }
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
}

export interface SessionListItem {
  /** Absolute path of the JSONL log (the `resume` frame's only accepted form). */
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

/** One host frame per WS text message. */
export function serializeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}
