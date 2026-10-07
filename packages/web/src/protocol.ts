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
/** Mode vocabularies are core's (the config schema and the engine speak them). */
export type { ApprovalMode } from '@nova-agent/core';
/** The command catalog's row shape is the kernel assembly's (`Kernel.commands`). */
export type { CommandSummary } from '@nova-agent/plugins';
/** The model catalog's shapes are core's too (the picker's contract). */
export type { ModelGroup, ModelOption } from '@nova-agent/core';
/** The editable model list's row shape is core's too (config `models[]`). */
export type { ConfiguredModel, ModelCapabilities } from '@nova-agent/core';
/** The git lens's row shapes are core's too (the runner's own contract). */
export type { GitLogEntry, GitStatusEntry } from '@nova-agent/core';
/** The 任务 tab's row shape (output-free, by design — see server-frames.ts). */
export type { WireJobRow } from './server-frames.js';
/** Durable image references cross the wire as ids + metadata, never as bytes. */
export type { ImageAttachmentRef } from '@nova-agent/core';/** One roster row (the `/plugins` panel's contract). */
export type { WireRosterEntry } from './roster-entry.js';
/**
 * The BYOK rows the settings page edits. The stored shape (`StoredProvider`)
 * lives in the server package, not here: the wire needs the input shape (what a
 * save carries) and must stay free to differ from what the file holds — the file
 * carries a secret, this never does.
 */
export type { WireProviderInput, WireProviderModel, WireProviderRow } from './provider-wire.js';

/**
 * Every bound the wire enforces lives in `wire-limits.ts` and is re-exported
 * here: the frame contract reads them by value to enforce, the shapes below are
 * read by type to validate, and a consumer of either should not need two imports.
 */
export {
  HISTORY_TAIL,
  MAX_CLIENT_FRAME_BYTES,
  MAX_COMMAND_ARGS_CHARS,
  MAX_COMMAND_NAME_CHARS,
  MAX_CONFIGURED_MODELS,
  MAX_FILE_MATCHES,
  MAX_FILE_QUERY_CHARS,
  MAX_HISTORY_BLOCKS,
  MAX_IMAGE_NAME_CHARS,
  MAX_MODALITY_CHARS,
  MAX_MODEL_CHARS,
  MAX_MODEL_MODALITIES,
  MAX_TITLE_MODEL_CHARS,
  MAX_PROMPT_CHARS,
  MAX_PROMPT_IMAGES,
  MAX_TERM_COLS,
  MAX_TERM_INPUT_CHARS,
  MAX_TERM_ROWS,
  MAX_TEXT_FIELD_CHARS,
  MAX_WORKSPACE_CHARS,
  TRACE_TAIL,
  MAX_EDITOR_BYTES,
  MAX_COMMIT_MESSAGE_CHARS,
  MAX_GIT_PATHS,
  MAX_GIT_LOG,
  MAX_GIT_CLONE_URL_CHARS,
  MAX_SHELL_PATH_CHARS,
} from './wire-limits.js';
/**
 * The BYOK bounds live with their own family (`provider-limits.ts`): a limit on
 * an API key is a judgement about a secrets file, not about prompt size. Both are
 * re-exported here so a consumer of either direction still needs one import.
 */
export { MAX_API_KEY_CHARS, MAX_BASE_URL_CHARS, MAX_PROVIDERS, MAX_PROVIDER_NAME_CHARS } from './provider-limits.js';

/**
 * There is exactly ONE route carrying image bytes, and no route carrying files.
 *
 * A file reaches a prompt as an `@path` reference to where it already lives on
 * the host, because the model can read it there with its own tools. An image
 * PASTED from the clipboard has no path anywhere, so its bytes must be sent —
 * `POST /api/image` (`image-upload.ts`) is that route, and it accepts only
 * raster bytes that are about to become image content. The route it replaces
 * (`POST /api/upload`) copied ANY file into `~/.nova/cache/uploads/` so
 * `read_file` could reach it, which fed the model nothing it could not read from
 * the original path while duplicating the user's bytes forever.
 */

/**
 * The client→host frames live in `client-frames.ts`: the union is the part that
 * grows with every feature, so it owns its own file. Re-exported here so a
 * consumer importing either direction (or a bound) still needs one import.
 */
export * from './client-frames.js';

/**
 * The host→client frames live in `server-frames.ts` and are re-exported here,
 * so a consumer importing either direction (or a limit) still needs one import.
 * `serializeServerFrame` stays below, beside the frame-name dispatch.
 */
export * from './server-frames.js';

import type { ServerFrame } from './server-frames.js';

export function serializeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}