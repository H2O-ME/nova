import { describe, expect, it } from 'vitest';
import { parseClientFrame } from '../src/client-frame.js';
import {
  MAX_CLIENT_FRAME_BYTES,
  MAX_COMMAND_ARGS_CHARS,
  MAX_COMMAND_NAME_CHARS,
  MAX_HISTORY_BLOCKS,
  MAX_MODEL_CHARS,
  MAX_PROMPT_CHARS,
  MAX_SHELL_PATH_CHARS,
  serializeServerFrame,
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
    expect(frame({ type: 'load_earlier', have: 0 })).toEqual({ type: 'load_earlier', have: 0 });
    expect(frame({ type: 'load_trace', have: 0 })).toEqual({ type: 'load_trace', have: 0 });
    expect(frame({ type: 'stop_job', id: 'bash-1' })).toEqual({ type: 'stop_job', id: 'bash-1' });
  });

  it('stop_job takes a job id and nothing else', () => {
    expect(frame({ type: 'stop_job', id: 'bash-1; rm -rf /' })).toMatchObject({ ok: false });
    expect(frame({ type: 'stop_job' })).toMatchObject({ ok: false });
  });

  it('carries a shell choice on term_open and refuses a junk one', () => {
    const cmd = 'C:\\Windows\\System32\\cmd.exe';
    expect(frame({ type: 'term_open', cols: 80, rows: 24, shell: cmd }))
      .toEqual({ type: 'term_open', cols: 80, rows: 24, shell: cmd });
    // No choice is a real answer: the host starts its own default.
    expect(frame({ type: 'term_open', cols: 80, rows: 24 })).toEqual({ type: 'term_open', cols: 80, rows: 24 });
    for (const bad of ['', 42, 'a\u0000b', 'x'.repeat(MAX_SHELL_PATH_CHARS + 1)]) {
      expect(frame({ type: 'term_open', cols: 80, rows: 24, shell: bad }), JSON.stringify(bad))
        .toMatchObject({ ok: false });
    }
  });

  it('asks for the host’s shell inventory with no payload', () => {
    expect(frame({ type: 'discover_shells' })).toEqual({ type: 'discover_shells' });
  });

  it('rejects a pagination cursor that is not a count', () => {
    // The cursor indexes the host's baseline: anything but a bounded integer
    // (a float, a negative, a string, a missing field) is refused up front.
    expect(frame({ type: 'load_earlier' })).toMatchObject({ ok: false, reason: expect.stringContaining('have') });
    expect(frame({ type: 'load_earlier', have: -1 })).toMatchObject({ ok: false });
    expect(frame({ type: 'load_earlier', have: 1.5 })).toMatchObject({ ok: false });
    expect(frame({ type: 'load_earlier', have: '40' })).toMatchObject({ ok: false });
    expect(frame({ type: 'load_earlier', have: MAX_HISTORY_BLOCKS + 1 })).toMatchObject({ ok: false });
    // The trace pages the same way over the event log: one cursor rule, two reads.
    expect(frame({ type: 'load_trace' })).toMatchObject({ ok: false, reason: expect.stringContaining('have') });
    expect(frame({ type: 'load_trace', have: '30' })).toMatchObject({ ok: false });
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

  it('normalizes answers into kernel grants; malformed shapes are rejected', () => {
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: 'always' })).toMatchObject({ answer: 'always' });
    // The wire's bare grants become the kernel's typed ones (core's parser).
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { scopeWords: 3 } })).toEqual({
      type: 'resolve_approval',
      id: 'apr_1',
      answer: { answer: 'always', scopeWords: 3 },
    });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { reason: ' 别跑 rm ' } })).toEqual({
      type: 'resolve_approval',
      id: 'apr_1',
      answer: { answer: 'deny', reason: '别跑 rm' },
    });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { scopeWords: 0 } })).toMatchObject({ ok: false });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { scopeWords: 33 } })).toMatchObject({ ok: false });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: 'maybe' })).toMatchObject({ ok: false });
    expect(frame({ type: 'resolve_approval', id: 'apr_1', answer: { reason: 'a\u001b[2Jb' } })).toMatchObject({ ok: false });
  });

  it('clamps a long denial reason instead of rejecting the answer', () => {
    // A reason is an instruction to the model, not a transcript; rejecting the
    // frame would strand the user at a modal whose only escape is a bare deny.
    const parsed = frame({ type: 'resolve_approval', id: 'apr_1', answer: { reason: 'x'.repeat(501) } });
    expect(parsed.type === 'resolve_approval' && parsed.answer).toEqual({ answer: 'deny', reason: 'x'.repeat(400) });
  });

  it('resume.file refuses control chars and non-jsonl', () => {
    expect(frame({ type: 'resume', file: '/tmp/x.txt' })).toMatchObject({ ok: false });
    expect(frame({ type: 'resume', file: 'C:' + String.fromCharCode(10) + 'b.jsonl' })).toMatchObject({ ok: false });
  });

  it('the approval-mode frame rejects an unknown mode', () => {
    expect(frame({ type: 'set_approval_mode', mode: 'yolo' })).toMatchObject({ ok: false });
  });

  it('model frames take an id and refuse junk ids', () => {
    expect(frame({ type: 'list_models' })).toEqual({ type: 'list_models' });
    expect(frame({ type: 'set_model', model: 'deepseek-v3' })).toEqual({ type: 'set_model', model: 'deepseek-v3' });
    // An id becomes `setModel` on the wire client, so it is validated like one:
    // empty, oversized and control-bearing ids never reach it.
    expect(frame({ type: 'set_model' })).toMatchObject({ ok: false, reason: expect.stringContaining('model') });
    expect(frame({ type: 'set_model', model: '  ' })).toMatchObject({ ok: false });
    expect(frame({ type: 'set_model', model: 'm'.repeat(MAX_MODEL_CHARS + 1) })).toMatchObject({ ok: false });
    expect(frame({ type: 'set_model', model: 'm\u001b[2J' })).toMatchObject({ ok: false, reason: expect.stringContaining('control') });
  });

  it('command frames take a registry word and an optional argument line', () => {
    expect(frame({ type: 'command', name: 'compact', args: '' })).toEqual({ type: 'command', name: 'compact', args: '' });
    // The argument is optional: a bare `/compact` is the common case, and the
    // parser supplies the empty string rather than making the client send one.
    expect(frame({ type: 'command', name: 'skill' })).toEqual({ type: 'command', name: 'skill', args: '' });
    expect(frame({ type: 'command', name: 'skill', args: 'pdf-tools' })).toEqual({ type: 'command', name: 'skill', args: 'pdf-tools' });
  });

  it('command names must look like registry names (the registry is not a shell)', () => {
    // Anything that is not a lowercase command word never reaches the registry:
    // a name with a slash, a space, an uppercase letter or a path separator is
    // rejected here rather than looked up.
    for (const name of ['', '/compact', 'Compact', 'two words', 'co/mpact', 'x'.repeat(MAX_COMMAND_NAME_CHARS + 1), 'co\u001bmpact']) {
      expect(frame({ type: 'command', name, args: '' })).toMatchObject({ ok: false });
    }
    expect(frame({ type: 'command' })).toMatchObject({ ok: false, reason: expect.stringContaining('name') });
  });

  it('a command argument cannot carry control junk or a document', () => {
    expect(frame({ type: 'command', name: 'skill', args: 'a\u001b[31mb' })).toMatchObject({ ok: false, reason: expect.stringContaining('control') });
    expect(frame({ type: 'command', name: 'skill', args: 'x'.repeat(MAX_COMMAND_ARGS_CHARS + 1) })).toMatchObject({ ok: false });
    expect(frame({ type: 'command', name: 'skill', args: 42 })).toMatchObject({ ok: false });
  });

  it('list_directory accepts an absent dir (the picker start) and a bounded path', () => {
    // The picker opens by asking for home, so the frame is valid with no path
    // at all; an explicit path is bounded like a workspace path.
    expect(frame({ type: 'list_directory' })).toEqual({ type: 'list_directory' });
    expect(frame({ type: 'list_directory', dir: 'D:/home/proj' })).toEqual({ type: 'list_directory', dir: 'D:/home/proj' });
    expect(frame({ type: 'list_directory', dir: '' })).toEqual({ type: 'list_directory', dir: '' });
  });

  it('list_directory refuses junk paths', () => {
    expect(frame({ type: 'list_directory', dir: 42 })).toMatchObject({ ok: false, reason: expect.stringContaining('string') });
    expect(frame({ type: 'list_directory', dir: 'D:/a\u001b[2Jb' })).toMatchObject({ ok: false, reason: expect.stringContaining('control') });
    expect(frame({ type: 'list_directory', dir: 'D:/' + 'x'.repeat(5000) })).toMatchObject({ ok: false, reason: expect.stringContaining('chars') });
  });

  it('create_directory takes a parent dir and a single name', () => {
    expect(frame({ type: 'create_directory', dir: 'D:/home/proj', name: 'fresh' })).toEqual({
      type: 'create_directory',
      dir: 'D:/home/proj',
      name: 'fresh',
    });
    // The dir is validated like a workspace path (it becomes a real host path),
    // and the name is bounded: the host's `isSafeDirectoryName` owns the rule,
    // this only guarantees the shape it can read.
    expect(frame({ type: 'create_directory', name: 'x' })).toMatchObject({ ok: false, reason: expect.stringContaining('dir') });
    expect(frame({ type: 'create_directory', dir: '', name: 'x' })).toMatchObject({ ok: false });
    expect(frame({ type: 'create_directory', dir: 'D:/p', name: 42 })).toMatchObject({ ok: false, reason: expect.stringContaining('name') });
    expect(frame({ type: 'create_directory', dir: 'D:/p', name: 'x'.repeat(65) })).toMatchObject({ ok: false, reason: expect.stringContaining('chars') });
    expect(frame({ type: 'create_directory', dir: 'D:/a\u001b[2Jb', name: 'x' })).toMatchObject({ ok: false, reason: expect.stringContaining('control') });
  });
});

describe('serializeServerFrame', () => {
  it('is JSON round-trippable', () => {
    const text = serializeServerFrame({ type: 'error', message: 'boom' });
    expect(JSON.parse(text)).toEqual({ type: 'error', message: 'boom' });
  });
});
