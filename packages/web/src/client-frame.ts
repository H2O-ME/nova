/**
 * The inbound half of the wire contract: one untrusted string in, either a
 * validated `ClientFrame` or a typed rejection out. Validation is total — no
 * `as` casts on the wire: unknown types, wrong shapes, oversized payloads and
 * embedded control junk in ids all come back as a rejection with a renderable
 * reason, and the frame budget doubles as a DoS floor. Nothing here touches the
 * kernel; the handle behind an accepted frame is trusted.
 */
import { hasControlChars, parseAskResult, parseQuestionAnswer } from '@nova-agent/core';
import {
  MAX_CLIENT_FRAME_BYTES,
  MAX_COMMAND_ARGS_CHARS,
  MAX_COMMAND_NAME_CHARS,
  MAX_HISTORY_BLOCKS,
  MAX_IMAGE_FRAME_BYTES,
  MAX_IMAGE_NAME_CHARS,
  MAX_MODALITY_CHARS,
  MAX_MODEL_CHARS,
  MAX_PROMPT_CHARS,
  MAX_SHELL_PATH_CHARS,
  MAX_TERM_COLS,
  MAX_TERM_INPUT_CHARS,
  MAX_TERM_ROWS,
  MAX_WORKSPACE_CHARS,
  type ClientFrame,
} from './protocol.js';
import { parseFsFrame, type FsFrameType } from './fs-frame-parse.js';
import { parseModelConfigFrame } from './model-config-parse.js';
import { parseProviderFrame } from './provider-parse.js';
import { parsePromptImages } from './prompt-image-parse.js';
import { reject, type FrameRejection } from './reject.js';

/** Ids crossing the wire (approval/session ids) are kernel-generated ASCII tokens. */
const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
/**
 * Skill names crossing the wire (`set_skill_enabled`): a plain identifier.
 *
 * A plugin ROW id deliberately does NOT use this grammar — see `PLUGIN_ID_RE`,
 * which a row id shares with `plugin_request` because it addresses the same
 * thing. An `[a-z0-9]`-anchored pattern silently excluded every extension row
 * (a scoped package specifier, or a relative module path), so the settings panel
 * could not switch one on or off and the refusal blamed the operator's input
 * rather than the validator.
 */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
/**
 * A plugin ID as `plugin_request` carries it.
 *
 * Broader than a switch name on purpose: an entry id is either a built-in's name
 * or a module specifier, and a specifier legitimately holds `@scope/name`, a
 * relative path, or a Windows absolute path. So the check is "printable, no
 * spaces, bounded" rather than a package-name grammar the host would have to keep
 * in step with the resolver's three cases.
 */
const PLUGIN_ID_RE = /^[^\s"'\\]{1,256}$/;
/** An operation name: an identifier the owning plugin chose. */
const OP_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
// Session files: absolute paths to JSONL under ~/.nova — length-capped, and
// control characters are rejected via core's `hasControlChars` (a
// `\u0000-\u001f` range in the literal would trip no-control-regex lint).
const FILE_RE = /^[^"]{1,512}\.jsonl$/;
/**
 * Command names: the registry's own vocabulary (`compact`, `skill`) — lowercase
 * ASCII words. Checked here so a hostile frame cannot reach the registry with a
 * name it would never contain.
 */
const COMMAND_RE = new RegExp(`^[a-z][a-z0-9_-]{0,${MAX_COMMAND_NAME_CHARS - 1}}$`);

/**
 * The store's only id shape (`core/image-store.ts`: `sha256:<64 lowercase hex>`).
 *
 * `prompt-image-parse.ts` holds the same pattern for the OTHER direction — an
 * image cited by a prompt — and the two are deliberately separate literals: one
 * guards "what may I put in a prompt" and one guards "what may I read back", and
 * collapsing them would tie two independent refusals to one edit. `readImage`
 * still verifies the digest, so a matching id that names nothing is a miss, not
 * a hit.
 */
const IMAGE_ID_RE = /^sha256:[a-f0-9]{64}$/;

/**
 * Whether a line declares the image-upload kind — read off the RAW text.
 *
 * The test runs before `JSON.parse` because the size ceiling exists to avoid
 * paying for a parse of the wrong type, so it cannot read a parsed object. It
 * is a tolerant header match (whitespace, quoting) rather than a strict prefix:
 * a test or a second shell may serialize differently, and guessing wrong here
 * would refuse a legitimate upload. A lying header buys only the right to be
 * parsed and size-checked; the real validation is the switch below.
 */
const IMAGE_UPLOAD_HEADER = /^\{\s*"type"\s*:\s*"image_upload"/u;

/**
 * The terminal's grid off the wire: two bounded integers, or the reason not.
 * @param frame - the frame name, for the rejection's prefix.
 * @param cols - the raw value.
 * @param rows - the raw value.
 * @returns the validated grid, or the rejection message.
 */
function parseGrid(frame: string, cols: unknown, rows: unknown): { cols: number; rows: number } | string {
  if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < 2 || cols > MAX_TERM_COLS) {
    return `${frame}.cols must be an integer in 2..${MAX_TERM_COLS}`;
  }
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > MAX_TERM_ROWS) {
    return `${frame}.rows must be an integer in 1..${MAX_TERM_ROWS}`;
  }
  return { cols, rows };
}

/** Parse + validate one inbound frame. Never throws on untrusted input. */
export function parseClientFrame(raw: string): ClientFrame | FrameRejection {
  // The size ceiling is BY TYPE, decided on the raw text before parsing: an
  // image upload is the one frame that legitimately carries megabytes, and
  // `JSON.parse` on a 16 MiB line is exactly the cost this check exists to
  // avoid paying for anything that is not one.
  if (Buffer.byteLength(raw, 'utf8') > MAX_CLIENT_FRAME_BYTES && !IMAGE_UPLOAD_HEADER.test(raw)) {
    return reject(`frame exceeds ${MAX_CLIENT_FRAME_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return reject('frame is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return reject('frame must be a JSON object');
  }
  const obj = value as Record<string, unknown>;
  const type = obj['type'];
  switch (type) {
    case 'prompt': {
      if (typeof obj['text'] !== 'string' || obj['text'].trim().length === 0) {
        return reject('prompt.text must be a non-empty string');
      }
      if (obj['text'].length > MAX_PROMPT_CHARS) {
        return reject(`prompt.text exceeds ${MAX_PROMPT_CHARS} chars`);
      }
      // A prompt is a document: newlines are its content, other C0 is junk.
      if (hasControlChars(obj['text'], { multiline: true })) return reject('prompt.text contains control characters');
      const images = parsePromptImages(obj['images']);
      if ('error' in images) return reject(images.error);
      return {
        type: 'prompt',
        text: obj['text'],
        ...(images.images.length === 0 ? {} : { images: images.images }),
      };
    }
    case 'abort':
    case 'compact':
    case 'list_sessions':
    case 'list_models':
    case 'new_session':
    case 'roster':
    case 'list_skills':
    case 'pick_file':
    case 'pick_directory':
    case 'list_jobs':
      return { type: obj['type'] } as ClientFrame;
    case 'set_plugin_enabled':
    case 'set_skill_enabled': {
      // A plugin ROW id or a skill name, each with its own grammar: a row id may
      // be a module specifier, a skill name is a plain identifier. Both are
      // validated here so a hostile frame cannot reach the config patcher with a
      // name the kernel would never contain.
      const name = obj['name'];
      const enabled = obj['enabled'];
      const pattern = obj['type'] === 'set_plugin_enabled' ? PLUGIN_ID_RE : SKILL_NAME_RE;
      if (typeof name !== 'string' || !pattern.test(name)) {
        return reject(`${String(obj['type'])}.name must be a plugin${obj['type'] === 'set_plugin_enabled' ? ' row id' : '/skill name'}`);
      }
      if (typeof enabled !== 'boolean') return reject(`${String(obj['type'])}.enabled must be a boolean`);
      return { type: obj['type'], name, enabled } as ClientFrame;
    }
    case 'plugin_request': {
      // Bounded here and validated no further: what an operation MEANS belongs to
      // the plugin that implements it, and the host deliberately has no opinion.
      // The bounds that do belong here are the transport's: a correlation id that
      // fits in a double, a namespace/op short enough to log, and a payload that
      // cannot exceed the frame budget (the socket's own size limit is the real
      // guard; this names the field so the reason is readable).
      const id = obj['id'];
      const plugin = obj['plugin'];
      const op = obj['op'];
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
        return reject('plugin_request.id must be a non-negative safe integer');
      }
      if (typeof plugin !== 'string' || !PLUGIN_ID_RE.test(plugin)) {
        return reject('plugin_request.plugin must be a plugin id');
      }
      if (typeof op !== 'string' || !OP_NAME_RE.test(op)) {
        return reject('plugin_request.op must be an operation name');
      }
      const payload = obj['payload'];
      return payload === undefined
        ? { type: 'plugin_request', id, plugin, op }
        : { type: 'plugin_request', id, plugin, op, payload };
    }
    case 'command': {
      const name = obj['name'];
      const args = obj['args'] ?? '';
      if (typeof name !== 'string' || !COMMAND_RE.test(name)) return reject('command.name must be a lowercase command word');
      if (typeof args !== 'string' || args.length > MAX_COMMAND_ARGS_CHARS) {
        return reject(`command.args must be a string of at most ${MAX_COMMAND_ARGS_CHARS} chars`);
      }
      if (hasControlChars(args)) return reject('command.args contains control characters');
      return { type: 'command', name, args };
    }
    case 'load_earlier': {
      const have = obj['have'];
      if (typeof have !== 'number' || !Number.isInteger(have) || have < 0 || have > MAX_HISTORY_BLOCKS) {
        return reject(`load_earlier.have must be an integer in 0..${MAX_HISTORY_BLOCKS}`);
      }
      return { type: 'load_earlier', have };
    }
    case 'load_trace': {
      // Same cursor rule as `load_earlier`, over the durable log's rows instead
      // of the transcript's blocks: counting from the newest, how many the
      // client already holds.
      const have = obj['have'];
      if (typeof have !== 'number' || !Number.isInteger(have) || have < 0 || have > MAX_HISTORY_BLOCKS) {
        return reject(`load_trace.have must be an integer in 0..${MAX_HISTORY_BLOCKS}`);
      }
      return { type: 'load_trace', have };
    }
    case 'context':
      // No payload: the reading is whatever the session currently holds, so
      // there is nothing for a client to state (or to forge).
      return { type: 'context' };
    case 'discover_shells':
      // Same shape as `context`: the answer is what the HOST has installed.
      return { type: 'discover_shells' };
    case 'resolve_approval': {
      if (typeof obj['id'] !== 'string' || !ID_RE.test(obj['id'])) return reject('resolve_approval.id must be an ASCII token');
      // The answer's shape is core's business, not the wire's: `parseAskResult`
      // (the kernel's single parser) decides what a well-formed answer is.
      const answer = parseAskResult(obj['answer']);
      if (answer === undefined) return reject('resolve_approval.answer must be allow/deny/always (+scope) or deny (+reason)');
      return { type: 'resolve_approval', id: obj['id'], answer };
    }
    case 'resolve_question': {
      if (typeof obj['id'] !== 'string' || !ID_RE.test(obj['id'])) return reject('resolve_question.id must be an ASCII token');
      // The batch's shape is core's business (the `parseAskResult` precedent):
      // this checks only what the wire can see. Whether the answer fits the
      // questions that were ASKED is the broker's check, because only it holds
      // the request.
      const answer = parseQuestionAnswer(obj['answer']);
      if (answer === undefined) return reject('resolve_question.answer must be {answers:[{id, selected, custom?}]}');
      return { type: 'resolve_question', id: obj['id'], answer };
    }
    case 'cancel_question': {
      if (typeof obj['id'] !== 'string' || !ID_RE.test(obj['id'])) return reject('cancel_question.id must be an ASCII token');
      return { type: 'cancel_question', id: obj['id'] };
    }
    case 'resume': {
      if (typeof obj['file'] !== 'string' || !FILE_RE.test(obj['file']) || hasControlChars(obj['file'])) {
        return reject('resume.file must be a .jsonl path without control chars');
      }
      return { type: 'resume', file: obj['file'] };
    }
    case 'delete_session': {
      // Same rule as `resume`: the frame carries a path and the host re-validates
      // it against the sessions root. Checked here too so a hostile frame is
      // refused at the wire rather than inside the unlink.
      if (typeof obj['file'] !== 'string' || !FILE_RE.test(obj['file']) || hasControlChars(obj['file'])) {
        return reject('delete_session.file must be a .jsonl path without control chars');
      }
      return { type: 'delete_session', file: obj['file'] };
    }
    case 'set_workspace':
    case 'list_files':
    case 'list_directory':
    case 'create_directory':
    case 'read_entry':
    case 'rename_entry':
    case 'remove_entry':
    case 'new_entry':
    case 'open_entry':
    case 'git_status':
    case 'git_diff':
    case 'git_stage':
    case 'git_unstage':
    case 'git_commit':
    case 'git_log':
    case 'git_clone':
      // The path-shaped frames share their own rules (see `fs-frame-parse.ts`).
      return parseFsFrame(obj['type'] as FsFrameType, obj);
    case 'stop_job': {
      if (typeof obj['id'] !== 'string' || !ID_RE.test(obj['id'])) return reject('stop_job.id must be an ASCII token');
      return { type: 'stop_job', id: obj['id'] };
    }
    case 'image_upload': {
      // Base64, because the pipe is line-JSON and there is no request body to
      // put bytes in. Bounded by the ONE exemption (16 MiB), checked here as
      // well as on the raw text: the raw check only decides what may be parsed,
      // and this is the ceiling the handler will actually pay memory for.
      const data = obj['data'];
      if (typeof data !== 'string' || data.length === 0) return reject('image_upload.data must be a non-empty base64 string');
      if (Buffer.byteLength(data, 'utf8') > MAX_IMAGE_FRAME_BYTES) {
        return reject(`image_upload.data exceeds ${MAX_IMAGE_FRAME_BYTES} chars`);
      }
      const name = obj['name'];
      if (name !== undefined && (typeof name !== 'string' || name.length > MAX_IMAGE_NAME_CHARS)) {
        return reject(`image_upload.name must be a string of at most ${MAX_IMAGE_NAME_CHARS} chars`);
      }
      const mediaType = obj['mediaType'];
      if (
        mediaType !== undefined &&
        (typeof mediaType !== 'string' || mediaType.length > MAX_MODALITY_CHARS || hasControlChars(mediaType))
      ) {
        return reject(`image_upload.mediaType must be a short type string`);
      }
      return {
        type: 'image_upload',
        data,
        ...(typeof name === 'string' ? { name } : {}),
        ...(typeof mediaType === 'string' ? { mediaType } : {}),
      };
    }
    case 'image_bytes': {
      if (typeof obj['id'] !== 'string' || !IMAGE_ID_RE.test(obj['id'])) {
        return reject('image_bytes.id must be a sha256 digest');
      }
      return { type: 'image_bytes', id: obj['id'] };
    }
    case 'dashboard':
      return { type: 'dashboard' };
    case 'context_window': {
      // `session` is a log path and is re-validated against the sessions root by
      // the handler (`sessionLogPath`), exactly as `resume`/`delete_session` do;
      // this checks only what the wire can see.
      if (typeof obj['session'] !== 'string' || !FILE_RE.test(obj['session']) || hasControlChars(obj['session'])) {
        return reject('context_window.session must be a .jsonl path without control chars');
      }
      const seq = obj['seq'];
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
        return reject('context_window.seq must be a non-negative integer');
      }
      return { type: 'context_window', session: obj['session'], seq };
    }
    case 'plugin_asset': {
      // A request path the plugin's own registry matches. It is never joined to
      // a filesystem path by the host, and the handler is the plugin's own — so
      // the wire only checks shape: rooted, no traversal segments, bounded.
      const path = obj['path'];
      if (typeof path !== 'string' || !path.startsWith('/') || path.length > MAX_WORKSPACE_CHARS) {
        return reject('plugin_asset.path must be a rooted request path');
      }
      if (hasControlChars(path) || path.includes('\\') || path.includes('..')) {
        return reject('plugin_asset.path must not contain control chars, backslashes or dot segments');
      }
      return { type: 'plugin_asset', path };
    }
    case 'term_resize': {
      const grid = parseGrid('term_resize', obj['cols'], obj['rows']);
      if (typeof grid === 'string') return reject(grid);
      return { type: 'term_resize', cols: grid.cols, rows: grid.rows };
    }
    case 'term_open': {
      // The grid is a size; `shell` is a PATH the host matches against the
      // shells it actually discovered — an unknown one is refused there rather
      // than spawned, so the wire only checks it is a plausible string.
      const grid = parseGrid('term_open', obj['cols'], obj['rows']);
      if (typeof grid === 'string') return reject(grid);
      const shell = obj['shell'];
      if (shell === undefined) return { type: 'term_open', cols: grid.cols, rows: grid.rows };
      if (typeof shell !== 'string' || shell.length === 0 || shell.length > MAX_SHELL_PATH_CHARS) {
        return reject(`term_open.shell must be a non-empty path of at most ${MAX_SHELL_PATH_CHARS} chars`);
      }
      if (hasControlChars(shell)) return reject('term_open.shell must not contain control chars');
      return { type: 'term_open', cols: grid.cols, rows: grid.rows, shell };
    }
    case 'term_input': {
      // Raw keystrokes/paste for the pty. Control characters are the CONTENT
      // (Enter is CR, arrows are escape sequences), so the only bound is size —
      // there is nothing here that could be "junk".
      const data = obj['data'];
      if (typeof data !== 'string' || data.length === 0) return reject('term_input.data must be a non-empty string');
      if (data.length > MAX_TERM_INPUT_CHARS) {
        return reject(`term_input.data exceeds ${MAX_TERM_INPUT_CHARS} chars`);
      }
      return { type: 'term_input', data };
    }
    case 'term_kill':
      return { type: 'term_kill' };
    case 'set_approval_mode': {
      const mode = obj['mode'];
      if (mode !== 'read-only' && mode !== 'auto-edit' && mode !== 'full') return reject('set_approval_mode.mode invalid');
      return { type: 'set_approval_mode', mode };
    }
    case 'set_model': {
      const model = obj['model'];
      if (typeof model !== 'string' || model.trim().length === 0) return reject('set_model.model must be a non-empty string');
      if (model.length > MAX_MODEL_CHARS) return reject(`set_model.model exceeds ${MAX_MODEL_CHARS} chars`);
      if (hasControlChars(model)) return reject('set_model.model contains control characters');
      return { type: 'set_model', model };
    }
    case 'list_model_config':
    case 'save_models':
    case 'set_title_model':
      // The model catalog's own field bounds live with it (`model-config-parse`),
      // the way the workspace-path rules live in `fs-frame-parse`.
      return parseModelConfigFrame(type, obj);
    case 'list_providers':
    case 'save_providers':
    case 'set_provider':
    case 'probe_provider':
      // The BYOK family: a credential crosses this seam and a URL reaches
      // `fetch`, so its bounds live with it rather than here.
      return parseProviderFrame(type, obj);
    default:
      return reject(`unknown frame type: ${String(type ?? '(missing)')}`);
  }
}
