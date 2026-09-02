import { describe, expect, it } from 'vitest';
import { parseSse } from '../src/sse.js';

async function* bytes(...parts: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  for (const part of parts) yield encoder.encode(part);
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const ev of parseSse(stream)) out.push(ev.data);
  return out;
}

describe('parseSse', () => {
  it('parses data events across chunk boundaries', async () => {
    const datas = await collect(bytes('data: {"a"', ':1}\n\ndata: [DO', 'NE]\n\n'));
    expect(datas).toEqual(['{"a":1}', '[DONE]']);
  });

  it('handles CRLF endings and multi-line data', async () => {
    const datas = await collect(bytes('data: line1\ndata: line2\r\n\r\ndata: x\n'));
    expect(datas).toEqual(['line1\nline2', 'x']);
  });

  it('ignores comments and non-data fields', async () => {
    const datas = await collect(bytes(': ping\nevent: message\ndata: hi\n\n'));
    expect(datas).toEqual(['hi']);
  });

  it('flushes a trailing data line without a final newline', async () => {
    const datas = await collect(bytes('data: tail'));
    expect(datas).toEqual(['tail']);
  });
});
