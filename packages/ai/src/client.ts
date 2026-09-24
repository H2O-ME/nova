import type {
  AgentMessage,
  ChatProvider,
  ChatRequest,
  StreamEvent,
  ToolDefinition,
  Usage,
} from '@nova-agent/core';
import { parseSse } from './sse.js';

export interface OpenAICompatConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Retries for 429/5xx/network errors before the stream starts. Default 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. Default 500. */
  retryBaseDelayMs?: number;
  timeoutMs?: number;
  temperature?: number;
  /** Passed through as `max_tokens` when set. */
  maxTokens?: number;
  /**
   * Stable per-session id (pi-style cache routing): sent as the OpenAI
   * `prompt_cache_key` body field and as `x-session-id` /
   * `x-client-request-id` / `x-session-affinity` headers so gateways route
   * all turns of one session to the same cache-affine backend. Unknown body
   * fields and x-headers are ignored by providers that do not support them.
   */
  sessionId?: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Parsed `retry-after` hint; authoritative delay for the retry backoff. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Upper bound for the client's OWN exponential backoff between attempts. The
 * growth is base * 2^attempt + jitter: without a cap a generous
 * retryBaseDelayMs (or a late attempt) parks the run for minutes on a
 * transient 429/5xx. Server hints are capped separately in
 * parseRetryAfterMs; this caps only our own growth.
 */
export const RETRY_BACKOFF_MAX_MS = 32_000;

interface ProviderToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface ProviderChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      /** Chain-of-thought stream (DeepSeek reasoner style). */
      reasoning_content?: string;
      tool_calls?: ProviderToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    prompt_cache_hit_tokens?: number;
  };
  error?: { message?: string };
}

/**
 * Hand-rolled OpenAI-compatible streaming client.
 * - Internal AgentMessage/ToolDefinition IR is mapped to the wire format here,
 *   so core stays provider-agnostic.
 * - Every retry policy lives in stream(): 429/5xx/network errors before the
 *   stream starts, and mid-stream failures (dropped connections, provider
 *   error chunks, streams that end without a finish reason) retry within the
 *   same budget — after partial output a `reset` event lets consumers discard
 *   their in-flight state before the retry replays from scratch.
 */
export class OpenAICompatClient implements ChatProvider {
  private readonly config: OpenAICompatConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly timeoutMs: number;
  private requestSeq = 0;
  /**
   * Wire-format tool array cached by the input array's identity. The caller
   * (PluginHost.tools) returns a stable reference across turns until a tool
   * is registered/deregistered, so the sort+map work — which produces a
   * content-identical array every turn — only runs once per toolset. The
   * cache is per-client because the output is deterministic given the input;
   * a different toolset arrives as a different array reference and misses.
   */
  private readonly toolWireCache = new WeakMap<ToolDefinition[], Record<string, unknown>[]>();

  constructor(config: OpenAICompatConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 500;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  get model(): string {
    return this.config.model;
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  /**
   * Rebind the session identity (e.g. /new starts a fresh session): the
   * `prompt_cache_key` body field and the x-session-affinity headers follow
   * the new id from the next request on.
   */
  setSessionId(sessionId: string): void {
    this.config.sessionId = sessionId;
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const body = this.buildBody(req);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (req.signal?.aborted) throw abortError();
      // Whether any event of THIS attempt reached the consumer. A retry after
      // that must announce itself (reset) so partial state can be discarded;
      // before the first event a retry is transparent.
      let yielded = false;
      try {
        const { response, armIdleTimeout, disarm } = await this.fetchOnce(body, req.signal);
        try {
          const responseBody = response.body;
          if (!responseBody) throw new Error('response has no body');
          let sawFinish = false;
          // Every byte from the wire re-arms the idle timer, so a healthy
          // stream may run arbitrarily long — only a stalled one is cut.
          for await (const sse of parseSse(keepAlive(responseBody, armIdleTimeout))) {
            if (sse.data === '[DONE]') {
              sawFinish = true;
              return;
            }
            let chunk: ProviderChunk;
            try {
              chunk = JSON.parse(sse.data) as ProviderChunk;
            } catch {
              continue;
            }
            if (chunk.error) throw new Error(chunk.error.message ?? 'provider returned an error');
            const events = [...translateChunk(chunk)];
            if (events.length === 0) continue;
            yielded = true;
            for (const ev of events) {
              if (ev.type === 'finish') sawFinish = true;
              yield ev;
            }
          }
          // A stream that ends cleanly without a finish reason was cut off by
          // the gateway (dsh/codex "stream terminated before completion"):
          // treat it as a failure so it retries instead of silently
          // truncating the reply and reporting a complete turn.
          if (!sawFinish) throw new Error('upstream stream ended before completion (no finish reason)');
          return;
        } finally {
          disarm();
          await response.body?.cancel().catch(() => undefined);
        }
      } catch (err) {
        if (isAbortError(err)) {
          // A plain AbortError is only the user's signal — the idle timer
          // aborts with a named TimeoutError reason. Some runtimes drop the
          // reason, so classify by the request signal: if it never fired,
          // this was the stall timeout and the attempt is retryable.
          if (req.signal?.aborted) throw abortError();
          throw new Error('upstream stream stalled (idle timeout)');
        }
        if (req.signal?.aborted) throw abortError();
        lastError = err;
        if (!isRetryableError(err) || attempt === this.maxRetries) {
          throw lastError instanceof Error ? lastError : new Error(String(lastError));
        }
        if (yielded) {
          yield {
            type: 'reset',
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            error: errMessage(err),
          };
        }
        const retryAfterMs = err instanceof HttpError ? err.retryAfterMs : undefined;
        await sleep(retryAfterMs ?? this.backoffDelay(attempt), req.signal);
      }
    }
  }

  /**
   * ONE request attempt — every retry policy lives in stream(). The attempt's
   * own AbortController drives TWO bounded waits: the timeout covers the wait
   * for response headers (TTFT), and `armIdleTimeout` re-arms it while the
   * body streams. A generation that keeps producing bytes is never cut for
   * being slow; a stalled stream aborts into the retry path above.
   */
  private async fetchOnce(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{
    response: Response;
    armIdleTimeout: () => void;
    disarm: () => void;
  }> {
    const url = `${this.config.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const attemptController = new AbortController();
    const attemptSignal = attemptController.signal;
    const timeoutError = (): Error => {
      const err = new Error(`upstream stream stalled for ${this.timeoutMs}ms`);
      err.name = 'TimeoutError';
      return err;
    };
    let timer: NodeJS.Timeout | undefined = setTimeout(() => attemptController.abort(timeoutError()), this.timeoutMs);
    const armIdleTimeout = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => attemptController.abort(timeoutError()), this.timeoutMs);
    };
    const disarm = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const combined = signal ? AbortSignal.any([signal, attemptSignal]) : attemptSignal;
    const sessionHeaders =
      this.config.sessionId !== undefined
        ? {
            'x-session-id': this.config.sessionId,
            // Request-scoped id (the header's semantics): unique per attempt.
            'x-client-request-id': `${this.config.sessionId}-${++this.requestSeq}`,
            'x-session-affinity': this.config.sessionId,
          }
        : {};
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
          ...sessionHeaders,
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      disarm();
      throw err;
    }
    if (!response.ok) {
      disarm();
      const text = await response.text().catch(() => '');
      // An unparseable retry-after fails the attempt loudly (fail-closed):
      // the server asked for a wait we cannot honor, and silently guessing
      // either hammers a throttling endpoint or parks the run. Surface it as
      // the attempt's error (no retryAfterMs: the backoff falls back to ours)
      // rather than swallowing it into undefined.
      let retryAfterMs: number | undefined;
      try {
        retryAfterMs = parseRetryAfterMs(response.headers);
      } catch (err) {
        throw new HttpError(
          response.status,
          `HTTP ${response.status}: ${text.slice(0, 500)} (${errMessage(err)})`,
        );
      }
      throw new HttpError(response.status, `HTTP ${response.status}: ${text.slice(0, 500)}`, retryAfterMs);
    }
    // Headers arrived: the TTFT phase is over — the timer now belongs to the
    // body loop, which re-arms it per chunk via armIdleTimeout().
    return { response, armIdleTimeout, disarm };
  }

  /**
   * GET {baseURL}/models (OpenAI-compatible catalog endpoint); returns
   * de-duplicated model ids in stable alphabetical order. Used by /model to
   * offer the endpoint's actual model list instead of manual names.
   */
  async listModels(): Promise<string[]> {
    const url = `${this.config.baseURL.replace(/\/+$/, '')}/models`;
    const response = await this.fetchImpl(url, {
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new HttpError(response.status, `HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    const json = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (json.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  }

  private buildBody(req: ChatRequest): Record<string, unknown> {
    const messages: Record<string, unknown>[] = [];
    if (req.systemPrompt && req.systemPrompt.length > 0) {
      messages.push({ role: 'system', content: req.systemPrompt });
    }
    for (const msg of req.messages) messages.push(toProviderMessage(msg));
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (this.config.temperature !== undefined) body['temperature'] = this.config.temperature;
    if (this.config.maxTokens !== undefined) body['max_tokens'] = this.config.maxTokens;
    if (this.config.sessionId !== undefined) {
      // OpenAI documents 64 chars as the prompt_cache_key budget.
      body['prompt_cache_key'] = [...this.config.sessionId].slice(0, 64).join('');
    }
    if (req.tools && req.tools.length > 0) {
      body['tools'] = this.serializeTools(req.tools);
    }
    return body;
  }

  /**
   * Map internal tool definitions to the OpenAI wire format with a stable
   * dictionary sort by name. Cached by the input array's identity — callers
   * hand us the same reference turn after turn (PluginHost.tools), so the
   * sort + map only runs the first time. A different toolset arrives as a
   * fresh array and misses. The cached array is treated as immutable from
   * the caller's side: it flows into {@link buildBody}'s output and then to
   * JSON.stringify, never mutated in place.
   */
  private serializeTools(tools: ToolDefinition[]): Record<string, unknown>[] {
    const cached = this.toolWireCache.get(tools);
    if (cached !== undefined) return cached;
    const wire = [...tools]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(toProviderTool);
    this.toolWireCache.set(tools, wire);
    return wire;
  }

  private backoffDelay(attempt: number): number {
    return Math.min(
      this.retryBaseDelayMs * 2 ** attempt + Math.random() * (this.retryBaseDelayMs / 2),
      RETRY_BACKOFF_MAX_MS,
    );
  }
}

/**
 * ai keeps `@nova-agent/core` as a types-only dependency to stay a provider-agnostic
 * leaf runtime. Error-message narrowing is a 3-line idiom, so it lives here locally
 * rather than forcing the first ai→core runtime edge for one helper.
 */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toProviderMessage(msg: AgentMessage): Record<string, unknown> {
  switch (msg.role) {
    case 'system':
    case 'user':
      return { role: msg.role, content: msg.content };
    case 'assistant': {
      const out: Record<string, unknown> = { role: 'assistant', content: msg.content };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        out['tool_calls'] = msg.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.rawArgs.length > 0 ? call.rawArgs : '{}',
          },
        }));
      }
      return out;
    }
    case 'tool':
      return { role: 'tool', tool_call_id: msg.toolCallId, content: msg.content };
  }
}

function toProviderTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** Chain-of-thought text of one delta, under any of the three field names
 * gateways use — or undefined when this chunk carries none. */
function reasoningText(raw: Record<string, unknown> | undefined): string | undefined {
  for (const key of ['reasoning_content', 'reasoning', 'thought']) {
    const value = raw?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** Tool-call deltas of one chunk. Empty/null members count as absent (some
 * gateways repeat entries with empty id/name and null arguments), and `index`
 * is coerced to 0 unless it is a non-negative integer — the accumulator keys
 * by it, so a NaN-shaped index must not open a second accumulator. */
function toolCallDeltas(deltas: ProviderToolCallDelta[]): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (const tc of deltas) {
    const id = typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : undefined;
    const name =
      typeof tc.function?.name === 'string' && tc.function.name.length > 0 ? tc.function.name : undefined;
    const argsDelta =
      typeof tc.function?.arguments === 'string' && tc.function.arguments.length > 0
        ? tc.function.arguments
        : undefined;
    if (id === undefined && name === undefined && argsDelta === undefined) continue;
    const index = typeof tc.index === 'number' && Number.isInteger(tc.index) && tc.index >= 0 ? tc.index : 0;
    out.push({
      type: 'tool_call_delta',
      index,
      ...(id !== undefined ? { id } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(argsDelta !== undefined ? { argsDelta } : {}),
    });
  }
  return out;
}

/** The chunk's usage, normalised across the two cache-reporting shapes. */
function usageFrom(raw: NonNullable<ProviderChunk['usage']>): Usage {
  return {
    promptTokens: raw.prompt_tokens ?? 0,
    completionTokens: raw.completion_tokens ?? 0,
    cachedTokens: raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? 0,
  };
}

/** One provider chunk → the events it carries, in wire order. */
function* translateChunk(chunk: ProviderChunk): Generator<StreamEvent> {
  const choice = chunk.choices?.[0];
  if (choice) {
    const delta = choice.delta;
    const reasoning = reasoningText(delta as Record<string, unknown> | undefined);
    if (reasoning !== undefined) yield { type: 'reasoning_delta', text: reasoning };
    if (delta?.content) yield { type: 'text_delta', text: delta.content };
    if (delta?.tool_calls) yield* toolCallDeltas(delta.tool_calls);
    if (choice.finish_reason) yield { type: 'finish', finishReason: choice.finish_reason };
  }
  if (chunk.usage) yield { type: 'usage', usage: usageFrom(chunk.usage) };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Retry-worthiness of one failed attempt. HTTP 4xx (except 429) is terminal —
 * the request itself is wrong and retrying cannot fix it. Everything else
 * (network errors, 429/5xx, mid-stream drops, provider error chunks, streams
 * that ended without a finish reason) is retried within the attempt budget.
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof HttpError) return isRetryableStatus(err.status);
  return true;
}

/**
 * Server-provided retry delay in ms from the `retry-after` response header.
 * Two RFC forms, both authoritative over our own backoff:
 * - delta-seconds (`120`): wait that many seconds from now — the common form;
 * - HTTP-date (`Sun, 06 Nov 1994 08:49:37 GMT`): wait until that instant
 *   (already past → 0, do not sleep backwards).
 * Returns undefined when the header is absent. Anything else present-but-
 * unparseable (a negative delta, a garbage string, a date that will not
 * parse) throws HttpError-style: the server asked us to wait an amount we
 * cannot honor, and silently guessing (0? 60s?) either hammers a throttled
 * endpoint or parks the run — fail loudly instead.
 */
export function parseRetryAfterMs(headers: Headers, nowMs: number = Date.now()): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const value = raw.trim();
  if (/^-?\d+$/.test(value)) {
    const seconds = Number.parseInt(value, 10);
    if (seconds < 0) throw new Error(`invalid retry-after header: ${JSON.stringify(raw)}`);
    // Cap at the client timeout so a huge server hint cannot stall the run.
    return Math.min(seconds * 1000, 60_000);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const seconds = Number.parseFloat(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`invalid retry-after header: ${JSON.stringify(raw)}`);
    }
    return Math.min(seconds * 1000, 60_000);
  }
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) throw new Error(`invalid retry-after header: ${JSON.stringify(raw)}`);
  return Math.max(0, Math.min(dateMs - nowMs, 60_000));
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Pass-through byte stream that re-arms the attempt's idle timer on every
 * raw chunk — keep-alive comments and partial SSE frames count as liveness
 * even though parseSse emits no event for them.
 */
async function* keepAlive(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk();
      if (value !== undefined) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}
