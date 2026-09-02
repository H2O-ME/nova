import {
  MCP_PROTOCOL_VERSION,
  McpError,
  abortError,
  unwrapResponse,
  type JsonRpcResponseLike,
  type McpRequestOptions,
  type McpTransport,
} from './protocol.js';

export interface HttpTransportOptions {
  headers?: Record<string, string>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  protocolVersion?: string;
}

interface SseEvent {
  data: string;
}

/**
 * MCP Streamable HTTP transport (spec: 2025-06-18 basic/transports#streamable-http):
 * every JSON-RPC message is POSTed; the response body is either a single
 * JSON object or an SSE stream carrying it. The `mcp-session-id` response
 * header is captured once and echoed on every later request. Server-initiated
 * SSE streams (GET) are not needed for request/response usage and are not
 * opened in v1.
 */
export class HttpMcpTransport implements McpTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly protocolVersion: string;
  private nextId = 0;
  private sessionId: string | undefined;

  constructor(
    private readonly url: string,
    options: HttpTransportOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = options.headers ?? {};
    this.protocolVersion = options.protocolVersion ?? MCP_PROTOCOL_VERSION;
  }

  async request(method: string, params: unknown, opts?: McpRequestOptions): Promise<unknown> {
    const id = ++this.nextId;
    const response = await this.post({ jsonrpc: '2.0', id, method, params }, opts);
    try {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        const sse = await firstSseResponse(response, id, opts?.signal);
        return unwrapResponse(sse);
      }
      const body = (await response.json()) as Parameters<typeof unwrapResponse>[0];
      return unwrapResponse(body);
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const response = await this.post(
      { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) },
      undefined,
    );
    if (!response.ok && response.status !== 202) {
      throw new McpError(`MCP notification "${method}" failed: HTTP ${response.status}`);
    }
    await response.body?.cancel().catch(() => undefined);
  }

  private async post(
    message: Record<string, unknown>,
    opts?: McpRequestOptions,
  ): Promise<Response> {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': this.protocolVersion,
          ...(this.sessionId !== undefined ? { 'mcp-session-id': this.sessionId } : {}),
          ...this.headers,
        },
        body: JSON.stringify(message),
        signal,
      });
    } catch (err) {
      if (opts?.signal?.aborted) throw abortError();
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new McpError(`MCP request "${String(message['method'])}" timed out after ${timeoutMs}ms`);
      }
      throw new McpError(`MCP request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new McpError(`MCP server returned HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    return response;
  }

  async close(): Promise<void> {
    // Stateless HTTP: nothing to tear down.
  }
}

/**
 * Read the SSE stream until the JSON-RPC response with the expected id
 * arrives; aborts with a clear error if the stream ends first.
 */
async function firstSseResponse(
  response: Response,
  expectedId: number,
  signal?: AbortSignal,
): Promise<JsonRpcResponseLike> {
  const body = response.body;
  if (!body) throw new McpError('MCP SSE response has no body');
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  const events: SseEvent[] = [];

  const emit = (): SseEvent | undefined => {
    if (dataLines.length === 0) return undefined;
    const event = { data: dataLines.join('\n') };
    dataLines = [];
    return event;
  };

  const reader = body.getReader();
  const readUntilEvent = async (): Promise<SseEvent | undefined> => {
    for (;;) {
      const next = events.shift();
      if (next !== undefined) return next;
      const { done, value } = await reader.read();
      if (done) {
        const tail = emit();
        return tail;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          const event = emit();
          if (event) return event;
        } else if (line.startsWith('data:')) {
          const value2 = line.slice(5);
          dataLines.push(value2.startsWith(' ') ? value2.slice(1) : value2);
        }
        newline = buffer.indexOf('\n');
      }
    }
  };

  try {
    for (;;) {
      const event = await Promise.race([
        readUntilEvent(),
        new Promise<undefined>((resolve) => {
          signal?.addEventListener('abort', () => resolve(undefined), { once: true });
        }),
      ]);
      if (event === undefined) throw abortError();
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== 'object') continue;
      const id = (parsed as { id?: unknown }).id;
      if (id === expectedId) return parsed as JsonRpcResponseLike;
      // responses to other ids (or notifications): keep reading
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
