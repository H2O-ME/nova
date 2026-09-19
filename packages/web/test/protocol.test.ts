import { describe, expect, it } from 'vitest';
import {
  MAX_CLIENT_FRAME_BYTES,
  MAX_PROMPT_CHARS,
  parseClientFrame,
  serializeServerFrame,
  toAskResult,
  type ClientFrame,
} from '../src/protocol.js';

function frame(json: unknown): ClientFrame | { ok: false; reason: string } {
  return parseClientFrame(typeof json === 'string' ? json : JSON.stringify(json));
}

describe('parseClientFrame', () => {
  it('accepts the full client vocabulary', () => {
    expect(frame({ type: 'prompt', text: 'hi' })).toEqual({ type: 'prompt', text: 'hi' });
    for (const bare of ['abort', 'compact', 'list_sessions', 'new_session'] as const) {
      expect(frame({ type: bare })).toEqual({ type: bare });
    }
    expect(frame({ type: 'resume', file: '/home/u/.nova/sessions/2026/09/19/sess_x.jsonl' })).toMatchObject({ type: 'resume' });
    expect(frame({ type: 'set_approval_mode', mode: 'auto-edit' })).toMatchObject({ mode: 'auto-edit' });
    expect(frame({ type: 'set_code_mode', mode: 'ptc' })).toMatchObject({ mode: 'ptc' });
  });

  it('rejects non-JSON, non-objects, unknown types and empty prompts', () => {
    expect(frame('not json')).toMatchObject({ ok: false });
    expect(frame([1, 2])).toMatchObject({ ok: false, reason: expect.stringContaining('object') });
    expect(frame({ type: 'teleport' })).toMatchObject({ ok: false, reason: expect.stringContaining('teleport') });
    expect(frame({ type: 'prompt', text: '   ' })).toMatchObject({ ok: false });
    expect(frame({ type: 'prompt' })).toMatchObject({ ok: false });
  });

  it('rejects oversized frames and oversized prompts', () => {
    expect(frame('x'.repeat(MAX_CLIENT_FRAME_BYTES + 1))).toMatchObject({ ok: false, reason: expect.stringContaining('bytes') });
    expect(frame({ type: 'prompt', text: 'y'.repeat(MAX_PROMPT_CHARS + 1) })).toMatchObject({ ok: false, reason: expect.stringContaining('chars') });
  });

  it('rejects control junk in prompt text and ids (injection floor)', () => {
    expect(frame({ type: 'prompt', text: 'a\u001b[31mb' })).toMatchObject({ ok: false, reason: expect.stringContaining('control') });
    expect(frame({ type: 'resolve_approval', id: 'apr\n1', answer: 'allow' })).toMatchObject({ ok: false });
    expect(frame({ type: 'resolve_approval', id: "apr\"x", answer: 'allow' })).toMatchObject({ ok: false });
  });

  it('normalizes answers; malformed scopes and long reasons are rejected', () => {
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: 'always' })).toMatchObject({ answer: 'always' });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { scopeWords: 3 } })).toMatchObject({ answer: { scopeWords: 3 } });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { reason: '别跑 rm' } })).toMatchObject({ answer: { reason: '别跑 rm' } });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { scopeWords: 0 } })).toMatchObject({ ok: false });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { scopeWords: 33 } })).toMatchObject({ ok: false });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { reason: 'x'.repeat(501) } })).toMatchObject({ ok: false });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: 'maybe' })).toMatchObject({ ok: false });
  });

  it('resume.file refuses control chars and non-jsonl', () => {
    expect(frame({ type: 'resume', file: '/tmp/x.txt' })).toMatchObject({ ok: false });
    expect(frame({ type: 'resume', file: 'C:' + String.fromCharCode(10) + 'b.jsonl' })).toMatchObject({ ok: false });
  });

  it('mode frames reject unknown modes', () => {
    expect(frame({ type: 'set_approval_mode', mode: 'yolo' })).toMatchObject({ ok: false });
    expect(frame({ type: 'set_code_mode', mode: 'quantum' })).toMatchObject({ ok: false });
  });
});

describe('toAskResult', () => {
  it('maps wire answers onto kernel AskResult shapes', () => {
    expect(toAskResult('allow')).toBe('allow');
    expect(toAskResult('deny')).toBe('deny');
    expect(toAskResult('always')).toBe('always');
    expect(toAskResult({ scopeWords: 2 })).toEqual({ answer: 'always', scopeWords: 2 });
    expect(toAskResult({ reason: 'nope' })).toEqual({ answer: 'deny', reason: 'nope' });
  });
});

describe('serializeServerFrame', () => {
  it('is JSON round-trippable', () => {
    const text = serializeServerFrame({ type: 'error', message: 'boom' });
    expect(JSON.parse(text)).toEqual({ type: 'error', message: 'boom' });
  });
});
