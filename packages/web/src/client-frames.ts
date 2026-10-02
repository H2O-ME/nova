/**
 * The client→host frames: the ONLY way anything mutates the kernel (prompt /
 * abort / answer / compact / switch / configure). Split from `protocol.ts` (which
 * now owns the exports, the bounds and the server-frame re-export) because the
 * union is the part that grows with every new feature, and a file that grows with
 * features should not also own the module's public surface.
 *
 * Every shape here is validated before it reaches this type — `client-frame.ts`
 * is the untrusted-input path.
 */
import type {
  ApprovalMode,
  AskResult,
  AskUserQuestionAnswer,
  ConfiguredModel,
  ImageAttachmentRef,
  PtcMode,
} from '@nova-agent/core';
import type { WireProviderInput } from './provider-wire.js';

export type ClientFrame =
  | {
      type: 'prompt';
      text: string;
      /**
       * Images to attach to this prompt, as references returned by the image
       * upload route.
       *
       * References and not bytes: the bytes were already committed by the
       * upload, and re-sending them here would put megabytes through a channel
       * that deliberately caps at 512 KiB. The host VERIFIES each reference
       * against the store before use, so a client cannot cite an image it never
       * uploaded (`admitPromptImages`).
       */
      images?: readonly ImageAttachmentRef[];
    }
  | { type: 'abort' }
  | { type: 'resolve_approval'; id: string; answer: AskResult }
  /**
   * A `ask_user_question` answer. `answers` is the kernel's own batch shape
   * (one entry per question), validated on the wire by core's
   * `parseQuestionAnswer` and again against the questions that were actually
   * asked by the broker — so a frame can only ever settle the request it fits.
   */
  | { type: 'resolve_question'; id: string; answer: AskUserQuestionAnswer }
  /**
   * Dismiss a whole question batch (the card's close control). The tool then
   * fails with the kernel's `ASK_CANCELLED` text, which the model reads as a
   * decision — the same defined outcome as an unanswered abort, not a hang.
   */
  | { type: 'cancel_question'; id: string }
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
  /**
   * Move the session's workspace root. The kernel re-rosters its tool host so
   * the fs/bash/search roots, the skills list and the environment fragment all
   * follow; the new root applies from the next tool dispatch. The answer is a
   * fresh `ready` (the root is part of the baseline), so every client re-states
   * the same workspace rather than trusting its own optimistic value.
   */
  | { type: 'set_workspace'; dir: string }
  /**
   * Delete one session log. The host validates the path against the sessions
   * root exactly as `resume` does, unlinks it, and answers with a fresh
   * `sessions` list — the row disappears because the listing says so, not
   * because the client dropped it optimistically.
   */
  | { type: 'delete_session'; file: string }
  /**
   * List workspace entries for the composer's `@` menu. `query` is the text
   * after `@`; the host walks the workspace root (bounded, skipping VCS and
   * dependency trees) and answers with the newest `MAX_FILE_MATCHES` entries.
   * A read of the filesystem, not a subscription.
   */
  | { type: 'list_files'; query: string }
  /**
   * List one directory level for the workspace picker. `dir` is an absolute
   * host path; absent or empty means the host home directory (where a picker
   * starts). The browser has no folder chooser of its own, so this is the only
   * way an in-page picker can show anything: the host enumerates, the browser
   * draws. Directories only, symlinks never followed.
   */
  | {
      type: 'list_directory';
      dir?: string;
      /**
       * Also list regular FILES (each row then carries `kind`).
       *
       * The workspace picker leaves this off — a row it cannot open as a folder
       * is noise. The attachment picker sets it, because a browser cannot obtain
       * a local file's real path any other way, and an `@` reference needs
       * exactly that.
       */
      files?: boolean;
    }
  /**
   * Create one folder inside `dir`, for the picker's "new folder" affordance.
   * `name` is a single path segment — validated on the host, not just here,
   * because it becomes a real directory name.
   */
  | { type: 'create_directory'; dir: string; name: string }
  /**
   * Open the host's NATIVE file dialog and name one file. A browser cannot
   * produce an absolute path (`File.path` is an Electron extension) and an `@`
   * reference needs exactly that — so the host, which runs on the user's
   * machine behind the same authentication as every other frame, opens the
   * dialog itself and answers with a `picked` frame.
   */
  | { type: 'pick_file' }
  /** Open the host's native FOLDER dialog, for adopting a workspace root. */
  | { type: 'pick_directory' }
  /**
   * Ask for the live plugin roster (the same rows `/plugins` prints) plus the
   * config file's path. Sent when the settings panel's plugins section opens:
   * a read of kernel state, not a subscription — the answer is a snapshot.
   * Rows now carry `enabled` + `origin` (+ optional `description`) so the
   * panel can group system/third-party plugins and offer the switch.
   */
  | { type: 'roster' }
  /**
   * Flip one plugin's switch. The host persists `plugins.disable`, re-rosters
   * in place, and answers with a fresh `plugins` frame — the panel re-renders
   * from that answer, never from the click. Refused while a run is live.
   */
  | { type: 'set_plugin_enabled'; name: string; enabled: boolean }
  /**
   * Flip one skill's switch. The host persists `skills.disable`, reloads the
   * skill index, and answers with a fresh `skills` frame. Refused mid-run.
   */
  | { type: 'set_skill_enabled'; name: string; enabled: boolean }
  /**
   * Ask for the Skill 中心's rows: the discovered skills (project + user) with
   * their per-name switch state. Sent when the skills section opens; the answer
   * is a snapshot — a workspace switch re-discovers, so a cached list could lie.
   */
  | { type: 'list_skills' }
  /**
   * Ask for the qqbot connection snapshot (appId presence, secret presence,
   * reference name — NEVER the secret). Sent when the qqbot page opens.
   */
  | { type: 'qqbot' }
  /**
   * Save the qqbot connection block. An empty `clientSecret` keeps the stored
   * value (the browser never holds it, so it cannot send it back); a non-empty
   * one overwrites verbatim — including an `{env:NAME}`-shaped value, which the
   * load path expands. The answer is a fresh `qqbot` snapshot.
   */
  | { type: 'save_qqbot'; appId?: string; clientSecret?: string }
  /**
   * Probe candidate qqbot credentials end to end (token grant + gateway
   * lookup). The candidate secret travels in this frame only — it is tested,
   * never stored. The answer is a `qqbot_test` frame, success or reason.
   */
  | { type: 'test_qqbot'; appId?: string; clientSecret?: string }
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
   * Read the operator's editable model list (config `models[]`), for the settings
   * page. Distinct from `list_models` on purpose: that one asks the ENDPOINT what
   * it serves (a live network call, the composer seat's menu), while this one
   * reports what the OPERATOR wrote — the list that, when non-empty, replaces the
   * endpoint's as the menu. A settings page that read only `list_models` could not
   * show a self-hosted id the endpoint never heard of, which is exactly what the
   * list exists to allow.
   */
  | { type: 'list_model_config' }
  /**
   * Replace the operator's model list wholesale (add / remove / re-capability).
   * Wholesale because the list IS the menu: the page owns every row, so a
   * per-row upsert would need the page to have read the file first. The host
   * answers with `model_config` (the list as now stored), so the page renders
   * what was durable rather than what was typed.
   */
  | { type: 'save_models'; models: readonly ConfiguredModel[] }
  /**
   * Read the provider list (BYOK). Distinct from `list_models` and
   * `list_model_config`: those describe MODELS, this describes the ENDPOINTS
   * that serve them. The answer carries each provider's baseURL and whether a
   * key is stored, never the key itself.
   */
  | { type: 'list_providers' }
  /**
   * Replace the provider list wholesale, and name the one in force.
   *
   * Wholesale for the same reason `save_models` is: the page owns every row, so
   * a per-row upsert would need it to have read the file first. An entry whose
   * `apiKey` is ABSENT keeps whatever is stored — the browser never holds a
   * stored key, so it cannot send one back, and an empty field must not erase it.
   */
  | { type: 'save_providers'; providers: readonly WireProviderInput[]; activeId?: string }
  /**
   * Switch the provider in force. The host retargets the ONE live client at the
   * chosen endpoint (`ChatProvider.setEndpoint`), reconciles the model id against
   * that endpoint's own catalog, and answers with a fresh `providers` snapshot —
   * so the seat follows the host's answer, never the click.
   */
  | { type: 'set_provider'; id: string }
  /**
   * Probe a candidate endpoint: `GET {baseURL}/models`. This is the "填写完成后
   * 获取模型列表" step, and it deliberately does NOT store anything — the operator
   * sees the pool first and then decides what to add. The candidate key travels in
   * this frame only; a stored key can be used by omitting it.
   */
  | { type: 'probe_provider'; baseURL: string; apiKey?: string }
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
  | { type: 'load_trace'; have: number }
  /**
   * Ask for the Context panel's reading, fresh (the tab's open/refresh path).
   *
   * The reading also rides `ready` and refreshes with each run's end; this
   * frame exists for the moments in between — opening the tab, or pulling it
   * back to date after the panel was hidden for a while.
   */
  | { type: 'context' }
  /**
   * Open this session's terminal: the host spawns ONE real PTY per session on
   * first use (a genuine pseudo-terminal — interactive programs, full-screen
   * apps and Ctrl-C all work) and answers with a `term` frame replaying the
   * retained scrollback (`reset: true`, because a browser reload or a tab
   * re-mount starts from an empty emulator). `cols` / `rows` are the size the
   * browser's emulator measured, so the PTY is born at the right geometry and
   * programs wrap correctly from their first line.
   *
   * `shell` is the PATH of one entry from the `shells` answer — the operator's
   * choice. Absent means the host's own default (the environment's shell, NOT
   * the one the model's commands run through). An unknown path is refused, not
   * spawned.
   */
  | { type: 'term_open'; cols: number; rows: number; shell?: string }
  /**
   * Ask which shells this host can actually start. The answer is `shells`:
   * installed candidates only (a row that would fail to spawn is not listed),
   * with the default first — so the menu and the first terminal never disagree.
   */
  | { type: 'discover_shells' }
  /**
   * Raw keystrokes and paste for the terminal's stdin — the browser emulator's
   * `onData` verbatim. Control characters are the CONTENT here (Enter is `CR`,
   * arrows are escape sequences), so the only bound is size.
   */
  | { type: 'term_input'; data: string }
  /** Resize the PTY to the emulator's new grid (a SIGWINCH to the shell). */
  | { type: 'term_resize'; cols: number; rows: number }
  /**
   * Terminate this session's PTY and its whole process tree. The next
   * `term_open` spawns a fresh one, so this is "end this terminal", not
   * "disable the panel".
   */
  | { type: 'term_kill' }
  /**
   * Read one workspace file into the editor panel. The answer is `entry` (with
   * `truncated` / `binary` readings) or `entry_error` when the path itself could
   * not be used.
   */
  | { type: 'read_entry'; path: string }
  /** Save one workspace file from the editor (whole-file write, atomic on disk). */
  | { type: 'write_entry'; path: string; content: string }
  /** Move one entry; `to` is the full target path. */
  | { type: 'rename_entry'; path: string; to: string }
  /** Delete one entry (a directory goes with its tree; the root is refused). */
  | { type: 'remove_entry'; path: string }
  /** Create one empty file or folder under `dir`. */
  | { type: 'new_entry'; dir: string; name: string; kind: 'file' | 'dir' }
  /**
   * Reveal one entry in the OS file manager (the panel's "open externally").
   * The host runs on the operator's machine behind the same authentication as
   * every other frame, so it is the side that can actually do this.
   */
  | { type: 'open_entry'; path: string }
  /** Read the workspace's git status (the 变更 tab's git lens). */
  | { type: 'git_status' }
  /** One file's diff; `staged` picks the index side. */
  | { type: 'git_diff'; path: string; staged: boolean }
  /** Add paths to the git index. */
  | { type: 'git_stage'; paths: readonly string[] }
  /** Remove paths from the git index. */
  | { type: 'git_unstage'; paths: readonly string[] }
  /** Commit the index with one message. */
  | { type: 'git_commit'; message: string }
  /** Recent commits, newest first. */
  | { type: 'git_log'; limit?: number }
  /**
   * Clone a repository and OPEN it: the target is the current workspace's
   * parent (the new repo becomes a sibling, not a child), and the answer is the
   * same re-stated surface a `set_workspace` gives, because the workspace did
   * change. Only here does a git frame move what is open — which is why it
   * routes with the session-target frames, not the git ones.
   */
  | { type: 'git_clone'; url: string }
  /**
   * List the live session's background jobs (the 任务 tab). Read-only: the
   * answer carries status and the sampled progress line, never output — output
   * reads consume the model's own cursor.
   */
  | { type: 'list_jobs' };
