/**
 * The wire contract between browser and host (M11 批2): JSON frames over one
 * WebSocket, one frame per message. Client frames are the ONLY way anything
 * mutates the kernel (prompt/abort/answer/compact/switch); host frames are
 * the kernel event stream plus list/replay answers.
 *
 * Every inbound string goes through `parseClientFrame` — an untrusted input
 * path, so validation is total (no `as` casts on the wire): unknown types,
 * wrong shapes, oversized payloads, embedded control junk in ids all come
 * back as a typed rejection with a renderable reason. The frame budget
 * doubles as a DoS floor; the kernel handle behind each frame is trusted.
 */
import type { ApprovalRequest, AskResult, KernelEvent } from '@nova-agent/core';

/** Max bytes of one inbound text frame (prompt bodies are user-typed, not tool dumps). */
export const MAX_CLIENT_FRAME_BYTES = 512 * 1024;
/** Max chars of a prompt — generous for pasted stack traces, far below frame size. */
export const MAX_PROMPT_CHARS = 200_000;
/** Ids crossing the wire (approval/session ids) are kernel-generated ASCII tokens. */
const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
// Session files: absolute paths to JSONL under ~/.nova — length-capped. The
// quote ban is here; control chars are rejected separately via hasControlJunk
// (a `\u0000-\u001f` range in the literal would trip no-control-regex lint).
const FILE_RE = /^[^"]{1,512}\.jsonl$/;

/** One answer shape for `resolve_approval`: bare verdict or scoped/reasoned grant. */
export type WireAnswer = 'allow' | 'deny' | 'always' | { scopeWords: number } | { reason: string };

export type ClientFrame =
  | { type: 'prompt'; text: string }
  | { type: 'abort' }
  | { type: 'resolve_approval'; id: string; answer: WireAnswer }
  | { type: 'compact' }
  | { type: 'list_sessions' }
  | { type: 'resume'; file: string }
  | { type: 'new_session' }
  | { type: 'set_approval_mode'; mode: 'read-only' | 'auto-edit' | 'full' }
  | { type: 'set_code_mode'; mode: 'native' | 'ptc' | 'both' };

export type ServerFrame =
  /** A kernel event, verbatim (the protocol IS the observable surface). */
  | { type: 'event'; event: KernelEvent }
  /** Everything a fresh client needs to rebuild the transcript. */
  | { type: 'ready'; info: ReadyInfo }
  | { type: 'sessions'; items: SessionListItem[] }
  | { type: 'error'; message: string };

export interface ReadyInfo {
  rootDir: string;
  sessionFile: string;
  model: string;
  approvalMode: 'read-only' | 'auto-edit' | 'full';
  codeMode: 'native' | 'ptc' | 'both';
  /** Messages projected from the durable log (replay baseline for reconnect). */
  history: readonly unknown[];
  /** Approval requests still outstanding (re-render the modal after reload). */
  pendingApprovals: readonly ApprovalRequest[];
}

export interface SessionListItem {
  file: string;
  title: string;
  mtime: number;
  workspace?: string;
}

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
      if (hasControlJunk(obj['text'])) return reject('prompt.text contains control characters');
      return { type: 'prompt', text: obj['text'] };
    }
    case 'abort':
    case 'compact':
    case 'list_sessions':
    case 'new_session':
      return { type: obj['type'] } as ClientFrame;
    case 'resolve_approval': {
      if (typeof obj['id'] !== 'string' || !ID_RE.test(obj['id'])) return reject('resolve_approval.id must be an ASCII token');
      const answer = normalizeAnswer(obj['answer']);
      if (answer === undefined) return reject('resolve_approval.answer must be allow/deny/always (+scope) or deny (+reason)');
      return { type: 'resolve_approval', id: obj['id'], answer };
    }
    case 'resume': {
      if (typeof obj['file'] !== 'string' || !FILE_RE.test(obj['file']) || hasAnyControlChar(obj['file'])) {
        return reject('resume.file must be a .jsonl path without control chars');
      }
      return { type: 'resume', file: obj['file'] };
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
    default:
      return reject(`unknown frame type: ${String(obj['type'] ?? '(missing)')}`);
  }
}

/** Wire answer → kernel AskResult; malformed shapes come back undefined. */
function normalizeAnswer(value: unknown): WireAnswer | undefined {
  if (value === 'allow' || value === 'deny' || value === 'always') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj['scopeWords'] === 'number' && Number.isInteger(obj['scopeWords']) && obj['scopeWords'] >= 1 && obj['scopeWords'] <= 32) {
      return { scopeWords: obj['scopeWords'] };
    }
    if (typeof obj['reason'] === 'string' && obj['reason'].trim().length > 0 && obj['reason'].length <= 500 && !hasControlJunk(obj['reason'])) {
      return { reason: obj['reason'].trim() };
    }
  }
  return undefined;
}

function hasControlJunk(text: string): boolean {
  return [...text].some((ch) => {
    const code = ch.codePointAt(0) ?? 0x20;
    return code < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t';
  });
}

/** A filesystem path is never multi-line: reject ALL control chars (incl. newline). */
function hasAnyControlChar(text: string): boolean {
  return [...text].some((ch) => (ch.codePointAt(0) ?? 0x20) < 0x20);
}

/** Wire answer → kernel AskResult (reason-carrying deny, scoped always). */
export function toAskResult(answer: WireAnswer): AskResult {
  if (answer === 'allow' || answer === 'deny' || answer === 'always') return answer;
  if ('scopeWords' in answer) return { answer: 'always', scopeWords: answer.scopeWords };
  return { answer: 'deny', reason: answer.reason };
}

/** One host frame per WS text message. */
export function serializeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

export function reject(reason: string): FrameRejection {
  return { ok: false, reason };
}