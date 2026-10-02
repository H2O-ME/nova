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
  MAX_MODEL_CHARS,
  MAX_PROMPT_CHARS,
  MAX_SHELL_PATH_CHARS,
  MAX_TERM_COLS,
  MAX_TERM_INPUT_CHARS,
  MAX_TERM_ROWS,
  MAX_TEXT_FIELD_CHARS,
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
 * Plugin/skill names crossing the wire (`set_plugin_enabled`, `set_skill_enabled`):
 * the roster's own names (lowercase words, digits, `-`/`_`/`.`). Checked here so
 * a hostile frame cannot reach the config patcher with a name the kernel would
 * never contain (path separators and `..` included).
 */
const SWITCH_NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
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
  if (Buffer.byteLength(raw, 'utf8') > MAX_CLIENT_FRAME_BYTES) {
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
    case 'qqbot':
    case 'pick_file':
    case 'pick_directory':
    case 'list_jobs':
      return { type: obj['type'] } as ClientFrame;
    case 'set_plugin_enabled':
    case 'set_skill_enabled': {
      // The switch's name is the kernel's own vocabulary (a roster/skill name),
      // validated like a command name: a hostile frame must not reach the
      // config patcher with a name the kernel would never contain.
      const name = obj['name'];
      const enabled = obj['enabled'];
      if (typeof name !== 'string' || !SWITCH_NAME_RE.test(name)) {
        return reject(`${String(obj['type'])}.name must be a plugin/skill name`);
      }
      if (typeof enabled !== 'boolean') return reject(`${String(obj['type'])}.enabled must be a boolean`);
      return { type: obj['type'], name, enabled } as ClientFrame;
    }
    case 'save_qqbot':
    case 'test_qqbot': {
      // Credentials-shaped fields: bounded text, no control junk. The secret is
      // tested, never stored (save stores only what the operator confirms; test
      // stores nothing) — the bound keeps a pasted key from becoming a DoS.
      const appId = obj['appId'] ?? '';
      const clientSecret = obj['clientSecret'] ?? '';
      if (typeof appId !== 'string' || appId.length > MAX_TEXT_FIELD_CHARS) {
        return reject(`${String(obj['type'])}.appId must be a string of at most ${MAX_TEXT_FIELD_CHARS} chars`);
      }
      if (typeof clientSecret !== 'string' || clientSecret.length > MAX_TEXT_FIELD_CHARS) {
        return reject(`${String(obj['type'])}.clientSecret must be a string of at most ${MAX_TEXT_FIELD_CHARS} chars`);
      }
      if (hasControlChars(appId) || hasControlChars(clientSecret)) {
        return reject(`${String(obj['type'])} fields contain control characters`);
      }
      return { type: obj['type'], appId, clientSecret } as ClientFrame;
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
    case 'set_code_mode': {
      const mode = obj['mode'];
      if (mode !== 'native' && mode !== 'ptc' && mode !== 'both') return reject('set_code_mode.mode invalid');
      return { type: 'set_code_mode', mode };
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
