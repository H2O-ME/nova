/**
 * The inbound half of the wire contract: one untrusted string in, either a
 * validated `ClientFrame` or a typed rejection out. Validation is total — no
 * `as` casts on the wire: unknown types, wrong shapes, oversized payloads and
 * embedded control junk in ids all come back as a rejection with a renderable
 * reason, and the frame budget doubles as a DoS floor. Nothing here touches the
 * kernel; the handle behind an accepted frame is trusted.
 */
import { hasControlChars, parseAskResult } from '@nova-agent/core';
import {
  MAX_CLIENT_FRAME_BYTES,
  MAX_COMMAND_ARGS_CHARS,
  MAX_COMMAND_NAME_CHARS,
  MAX_HISTORY_BLOCKS,
  MAX_MODEL_CHARS,
  MAX_PROMPT_CHARS,
  type ClientFrame,
} from './protocol.js';

/** Ids crossing the wire (approval/session ids) are kernel-generated ASCII tokens. */
const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
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

/** A frame the host refuses: the reason is meant to be logged and rendered. */
export type FrameRejection = { ok: false; reason: string };

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
  switch (obj['type']) {
    case 'prompt': {
      if (typeof obj['text'] !== 'string' || obj['text'].trim().length === 0) {
        return reject('prompt.text must be a non-empty string');
      }
      if (obj['text'].length > MAX_PROMPT_CHARS) {
        return reject(`prompt.text exceeds ${MAX_PROMPT_CHARS} chars`);
      }
      // A prompt is a document: newlines are its content, other C0 is junk.
      if (hasControlChars(obj['text'], { multiline: true })) return reject('prompt.text contains control characters');
      return { type: 'prompt', text: obj['text'] };
    }
    case 'abort':
    case 'compact':
    case 'list_sessions':
    case 'list_models':
    case 'new_session':
      return { type: obj['type'] } as ClientFrame;
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
    case 'resolve_approval': {
      if (typeof obj['id'] !== 'string' || !ID_RE.test(obj['id'])) return reject('resolve_approval.id must be an ASCII token');
      // The answer's shape is core's business, not the wire's: `parseAskResult`
      // (the kernel's single parser) decides what a well-formed answer is.
      const answer = parseAskResult(obj['answer']);
      if (answer === undefined) return reject('resolve_approval.answer must be allow/deny/always (+scope) or deny (+reason)');
      return { type: 'resolve_approval', id: obj['id'], answer };
    }
    case 'resume': {
      if (typeof obj['file'] !== 'string' || !FILE_RE.test(obj['file']) || hasControlChars(obj['file'])) {
        return reject('resume.file must be a .jsonl path without control chars');
      }
      return { type: 'resume', file: obj['file'] };
    }
    case 'stop_job': {
      if (typeof obj['id'] !== 'string' || !ID_RE.test(obj['id'])) return reject('stop_job.id must be an ASCII token');
      return { type: 'stop_job', id: obj['id'] };
    }
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
    default:
      return reject(`unknown frame type: ${String(obj['type'] ?? '(missing)')}`);
  }
}

/** The typed rejection — the single way an inbound frame is turned away. */
export function reject(reason: string): FrameRejection {
  return { ok: false, reason };
}