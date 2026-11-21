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
   * Flip one plugin's switch. The host writes that row's own `enabled` in
   * `plugins.entries`, re-rosters in place, and answers with a fresh
   * `plugins` frame — the panel re-renders from that answer, never from the
   * click. Refused while a run is live.
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
   * Run one operation on ONE plugin, addressed by the id its config row uses.
   *
   * This is the whole browser↔plugin seam: a plugin that owns a settings page, a
   * status readout or a probe registers a namespace with the `plugin-rpc` service
   * and answers here. The host is deliberately absent from the conversation — it
   * neither knows the plugin nor validates the operation, so a new plugin ships a
   * page without a host change. A plugin that is switched off has no namespace
   * registered, so it answers nothing and the request fails with a reason.
   *
   * `id` is the browser's own correlation token, echoed back on the response: the
   * page may have several requests in flight, and an answer must not be matched to
   * the wrong form.
   */
  | { type: 'plugin_request'; id: number; plugin: string; op: string; payload?: unknown }
  | { type: 'set_approval_mode'; mode: ApprovalMode }
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
   * Name the session-TITLE model (config `titleModel`), or clear it with `null`.
   *
   * A separate frame from `save_models` on purpose: the catalog editor and the
   * title row are two concerns, and coupling them would make each sender carry
   * the other's value (and let a stale catalog snapshot rewrite it). The host
   * answers with `model_config` (which carries the stored value), so the select
   * shows what is durable rather than what was clicked.
   */
  | { type: 'set_title_model'; model: string | null }
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
   * Read one workspace file into the editor panel. The answer is `entry` (with
   * `truncated` / `binary` readings) or `entry_error` when the path itself could
   * not be used.
   */
  | { type: 'read_entry'; path: string }
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
  /** Read the workspace's git status (the file tree's decorations). */
  | { type: 'git_status' }
  /**
   * Store one pasted image and answer with its durable reference.
   *
   * This replaces `POST /api/image` (`image-upload.ts`). The bytes ride base64
   * in the frame because the pipe is line-JSON and there is no request body to
   * put them in — and they are bounded by `MAX_IMAGE_FRAME_BYTES` (16 MiB), the
   * one frame kind exempt from the 512 KiB client ceiling. `mediaType` is a
   * routing hint only; the host re-sniffs the bytes and refuses a mislabeled
   * body, so what decides is always the sniffed type.
   */
  | { type: 'image_upload'; data: string; name?: string; mediaType?: string }
  /**
   * Read one stored image's bytes back (replaces `GET /api/image/<id>`).
   *
   * The transcript carries only the reference, so without this a reload would
   * silently drop every pasted image. `id` is a content digest, which is why the
   * browser may cache the answer for the life of the page.
   */
  | { type: 'image_bytes'; id: string }
  /**
   * The corpus activity reading (replaces `GET /api/dashboard`). No payload:
   * the reading is whatever the host's own fold produces, so a client cannot
   * name a different corpus than the one it is talking to.
   */
  | { type: 'dashboard' }
  /**
   * One request's frozen context window (replaces `GET /api/context-window`).
   * `seq` is the log position the reader asked about; `session` must sit under
   * the sessions root — re-validated host-side, exactly as delete/resume do.
   */
  | { type: 'context_window'; session: string; seq: number }
  /**
   * Read one plugin asset's bytes (replaces `<script src="/plugins/...">`).
   *
   * A plugin that ships a browser bundle registers an HTTP prefix; with no HTTP
   * server left, the same registry answers here instead, and the loader injects
   * the returned bytes as a blob. `path` is the request path the plugin's own
   * handler expects (`/plugins/<name>/<file>`), matched by the registry — so a
   * plugin's routing logic is unchanged.
   */
  | { type: 'plugin_asset'; path: string };
