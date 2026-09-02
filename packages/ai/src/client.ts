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
 * - Retries only apply before the stream starts; a broken mid-stream response
 *   surfaces as an error (no partial-stream resume in M1).
 */
export class OpenAICompatClient implements ChatProvider {
  private readonly config: OpenAICompatConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly timeoutMs: number;

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

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const body = this.buildBody(req);
    const response = await this.fetchWithRetry(body, req.signal);
    try {
      const responseBody = response.body;
      if (!responseBody) throw new Error('response has no body');
      for await (const sse of parseSse(responseBody)) {
        if (sse.data === '[DONE]') return;
        let chunk: ProviderChunk;
        try {
          chunk = JSON.parse(sse.data) as ProviderChunk;
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(chunk.error.message ?? 'provider returned an error');
        yield* translateChunk(chunk);
      }
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
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

  private async fetchWithRetry(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const url = `${this.config.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const sessionHeaders =
      this.config.sessionId !== undefined
        ? {
            'x-session-id': this.config.sessionId,
            'x-client-request-id': this.config.sessionId,
            'x-session-affinity': this.config.sessionId,
          }
        : {};
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.config.apiKey}`,
      ...sessionHeaders,
    };
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) throw abortError();
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: combined,
        });
        if (response.ok) return response;
        const text = await response.text().catch(() => '');
        const err = new HttpError(response.status, `HTTP ${response.status}: ${text.slice(0, 500)}`);
        if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
          lastError = err;
          // A server-provided delay (429 Retry-After) is authoritative; fall
          // back to exponential backoff only when it is absent or unparseable.
          const retryAfterMs = parseRetryAfterMs(response.headers);
          await sleep(retryAfterMs ?? this.backoffDelay(attempt), signal);
          continue;
        }
        throw err;
      } catch (err) {
        if (isAbortError(err)) throw err;
        if (err instanceof HttpError) throw err;
        lastError = err;
        if (attempt < this.maxRetries) {
          await sleep(this.backoffDelay(attempt), signal);
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
    if (delta?.content) yield { type: 'text_delta', text: delta.content };
    if (delta?.reasoning_content) yield { type: 'reasoning_delta', text: delta.reasoning_content };
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
        yield {
          type: 'tool_call_delta',
          index: tc.index,
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
