/**
 * The stdio pipe transport: line framing, the size exemption, and the EOF
 * teardown. Replaces `ws.test.ts`, which tested the socket adapter this deleted.
 *
 * Deliberately NOT a test of the controller: `controller.test.ts` and the
 * session frame tests already drive that with a fake `WsConnection`, and they are
 * unchanged — which is the point of the transport seam. What needs covering here
 * is exactly what the transport owns: how bytes become lines, which lines are
 * allowed to be huge, and what happens when the writer goes away.
 */
import { describe, expect, it } from 'vitest';
import { lineSplitter, MAX_PIPE_LINE_BYTES, pipeConnection } from '../src/pipe.js';
import { parseClientFrame } from '../src/client-frame.js';
import { MAX_CLIENT_FRAME_BYTES, MAX_IMAGE_FRAME_BYTES } from '../src/wire-limits.js';

describe('lineSplitter', () => {
  it('delivers one whole line per newline, in order, across chunk boundaries', () => {
    const seen: string[] = [];
    const splitter = lineSplitter({ onMessage: (line) => seen.push(line), onClose: () => seen.push('<close>') });
    splitter.push('{"type":"abo');
    splitter.push('rt"}\n{"type":"compact"}\n');
    splitter.push('{"type":"roster"}');
    splitter.end();
    expect(seen).toEqual(['{"type":"abort"}', '{"type":"compact"}', '{"type":"roster"}', '<close>']);
  });

  it('drops a blank line instead of reporting it as malformed', () => {
    // A shell that flushes twice, or an editor that appends a newline, must not
    // become a "frame is not valid JSON" error the operator has to read.
    const seen: string[] = [];
    const splitter = lineSplitter({ onMessage: (line) => seen.push(line), onClose: () => undefined });
    splitter.push('\n\n  \n{"type":"abort"}\n');
    splitter.end();
    expect(seen).toEqual(['{"type":"abort"}']);
  });

  it('refuses a line past the pipe ceiling and resumes at the next newline', () => {
    // The ceiling exists so a writer that never sends a newline cannot grow the
    // buffer without bound; the frame AFTER the oversized one must still arrive.
    const seen: string[] = [];
    const splitter = lineSplitter({ onMessage: (line) => seen.push(line), onClose: () => undefined });
    splitter.push('x'.repeat(MAX_PIPE_LINE_BYTES + 1));
    splitter.push('tail-of-the-same-line\n{"type":"abort"}\n');
    splitter.end();
    expect(seen).toEqual(['{"type":"abort"}']);
  });
});

describe('pipeConnection', () => {
  it('writes one newline-terminated line per frame, and stops after close', () => {
    const written: string[] = [];
    const connection = pipeConnection({ write: (chunk) => written.push(chunk) > 0 });
    connection.send('{"type":"ready"}');
    connection.close();
    connection.send('{"type":"error"}');
    expect(written).toEqual(['{"type":"ready"}\n']);
  });
});

describe('the image-upload size exemption', () => {
  it('lets an image_upload through above the standard ceiling, and refuses anything else that big', () => {
    // The ONLY frame kind allowed to carry megabytes. The exemption is by type,
    // so a prompt of the same size must still be refused — that is the whole
    // reason this is a whitelist rather than a raised global ceiling.
    const big = 'A'.repeat(MAX_CLIENT_FRAME_BYTES + 1024);
    const upload = JSON.stringify({ type: 'image_upload', data: big });
    expect(parseClientFrame(upload)).toMatchObject({ type: 'image_upload' });
    const prompt = JSON.stringify({ type: 'prompt', text: big });
    expect(parseClientFrame(prompt)).toMatchObject({ ok: false });
  });

  it('still enforces the per-type ceiling on an image_upload', () => {
    const tooBig = JSON.stringify({ type: 'image_upload', data: 'A'.repeat(MAX_IMAGE_FRAME_BYTES + 1) });
    expect(parseClientFrame(tooBig)).toMatchObject({ ok: false });
  });
});
