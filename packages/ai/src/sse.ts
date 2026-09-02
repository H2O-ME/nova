export interface SseEvent {
  data: string;
}

/**
 * Minimal SSE parser: extracts `data:` payloads, joins multi-line data with
 * newlines, emits on blank-line boundaries. Ignores event:/id:/retry: fields
 * and comment lines — the OpenAI-compatible wire only needs data.
 * Accepts any async iterable of byte chunks (fetch ReadableStream qualifies).
 */
export async function* parseSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  const handleLine = (rawLine: string): SseEvent | undefined => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      if (dataLines.length === 0) return undefined;
      const event: SseEvent = { data: dataLines.join('\n') };
      dataLines = [];
      return event;
    }
    if (line.startsWith(':')) return undefined;
    if (line.startsWith('data:')) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }
    return undefined;
  };

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx >= 0) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      const event = handleLine(line);
      if (event) yield event;
      newlineIdx = buffer.indexOf('\n');
    }
  }

  buffer += decoder.decode();
  if (buffer.length > 0) {
    const event = handleLine(buffer);
    if (event) yield event;
  }
  if (dataLines.length > 0) {
    yield { data: dataLines.join('\n') };
  }
}
