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
            error: err instanceof Error ? err.message : String(err),
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
      throw new HttpError(
        response.status,
        `HTTP ${response.status}: ${text.slice(0, 500)}`,
        parseRetryAfterMs(response.headers),
      );
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
      body['tools'] = req.tools.map(toProviderTool);
    }
    return body;
  }

  private backoffDelay(attempt: number): number {
    return this.retryBaseDelayMs * 2 ** attempt + Math.random() * (this.retryBaseDelayMs / 2);
  }
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

function* translateChunk(chunk: ProviderChunk): Generator<StreamEvent> {
  const choice = chunk.choices?.[0];
  if (choice) {
    const delta = choice.delta;
    const raw = delta as Record<string, unknown> | undefined;
    const reasoning =
      (typeof raw?.['reasoning_content'] === 'string' && raw['reasoning_content'].length > 0
        ? raw['reasoning_content']
        : undefined) ??
      (typeof raw?.['reasoning'] === 'string' && raw['reasoning'].length > 0
        ? raw['reasoning']
        : undefined) ??
      (typeof raw?.['thought'] === 'string' && raw['thought'].length > 0
        ? raw['thought']
        : undefined);
    if (reasoning !== undefined) yield { type: 'reasoning_delta', text: reasoning };
    if (delta?.content) yield { type: 'text_delta', text: delta.content };
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        // Some gateways repeat tool-call entries with empty strings for
        // id/name on argument-delta chunks, and null arguments; treat
        // empty and null as absent.
        const id = typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : undefined;
        const name =
          typeof tc.function?.name === 'string' && tc.function.name.length > 0
            ? tc.function.name
            : undefined;
        const argsDelta =
          typeof tc.function?.arguments === 'string' && tc.function.arguments.length > 0
            ? tc.function.arguments
            : undefined;
        if (id === undefined && name === undefined && argsDelta === undefined) continue;
        // Gateways disagree on `index` (missing, string, even NaN-shaped);
        // the accumulator keys deltas by it, so coerce anything non-integral
        // to 0 (OpenAI SDK convention) instead of letting Map keys diverge.
        const index =
          typeof tc.index === 'number' && Number.isInteger(tc.index) && tc.index >= 0 ? tc.index : 0;
        yield {
          type: 'tool_call_delta',
          index,
          ...(id !== undefined ? { id } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(argsDelta !== undefined ? { argsDelta } : {}),
        };
      }
    }
    if (choice.finish_reason) yield { type: 'finish', finishReason: choice.finish_reason };
  }
  if (chunk.usage) {
    const usage: Usage = {
      promptTokens: chunk.usage.prompt_tokens ?? 0,
      completionTokens: chunk.usage.completion_tokens ?? 0,
      cachedTokens:
        chunk.usage.prompt_tokens_details?.cached_tokens ??
        chunk.usage.prompt_cache_hit_tokens ??
        0,
    };
    yield { type: 'usage', usage };
  }
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

/** Server-provided retry delay in ms (delta-seconds form of `retry-after`). */
function parseRetryAfterMs(headers: Headers): number | undefined {
  const value = Number.parseFloat(headers.get('retry-after') ?? '');
  if (Number.isNaN(value) || value < 0) return undefined;
  // Cap at the client timeout so a huge server hint cannot stall the run.
  return Math.min(value * 1000, 60_000);
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
