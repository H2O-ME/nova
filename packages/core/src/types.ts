export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** raw JSON string as emitted by the provider; kept for replay fidelity */
  rawArgs: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export interface UsageStats {
  turns: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  /**
   * Cache-waste audit (pi cache-stats style): tokens paid at full input price
   * because they were not served from the provider prefix cache. Counted per
   * turn above a noise floor, and only once the provider has reported cache
   * activity at least once (a provider that never reports caching must not
   * make every turn look like a total miss).
   */
  missTokens: number;
  /** Turns whose miss exceeded the noise floor. */
  missTurns: number;
}

export interface BaseMessage {
  id: string;
  ts: number;
}

export interface SystemMessage extends BaseMessage {
  role: 'system';
  content: string;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  finishReason?: string;
}

export interface ToolResultMessage extends BaseMessage {
  role: 'tool';
  toolCallId: string;
  name: string;
  content: string;
  /** set when content was truncated and the full output was offloaded to disk */
  truncatedRef?: string;
}

/**
 * Messages form an append-only log: existing entries are never rewritten.
 * This invariant is what keeps the provider prompt prefix stable across
 * turns and is the foundation of cache-hit-rate management.
 */
export type AgentMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export type JsonSchema = Record<string, unknown>;

// Deferred import type to keep jobs.ts colocated with the loop contract.
type JobRegistry = import('./jobs.js').JobRegistry;

/** One nested tool call dispatched from inside another tool (PTC sub-call). */
export interface ToolDispatchCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Outcome of a nested dispatch. `ok: false` covers pipeline-level refusals
 * (permission denied, unknown tool, aborted run) — the sub-call never reached
 * a settled execution. A tool that ran and returned its own "Error: ..." text
 * is `ok: true`: exactly what the native loop would have logged.
 */
export type ToolDispatchResult = { ok: true; result: string } | { ok: false; error: string };

export interface ToolExecuteContext {
  rootDir: string;
  /**
   * Cooperative cancellation: the loop passes the run's abort signal, merged
   * with a per-call timeout signal when the tool declares `timeoutMs`. Async
   * work should observe or forward it; the loop never hard-kills same-process
   * code that ignores it.
   */
  signal?: AbortSignal;
  /** Background-job registry for tools that spawn long-running work. */
  jobs?: JobRegistry;
  /**
   * Persist a log-only session event (e.g. todo/write snapshots) without
   * joining the model surface. Wired by the host to the open session log.
   */
  emit?: (evt: import('./session.js').SessionEvent) => void | Promise<void>;
  /**
   * Live progress feed for long-running tools (bash output tail etc.),
   * forwarded from AgentOptions.onToolProgress. Fire-and-forget: consumers
   * render it best-effort and tools must not depend on it existing.
   */
  onProgress?: (text: string) => void;
  /**
   * Dispatch a nested tool call through the loop's FULL pipeline — the same
   * permission gate, beforeToolCall hooks, per-tool timeout and cooperative
   * abort a native call goes through (PTC mode: run_code routes its program
   * bindings here, so a program can never reach a tool the user would not be
   * asked about). Sub-calls never touch the message log; the dispatcher
   * returns their settled text to the calling tool. `signal` overrides the
   * run signal for this sub-call (run_code passes its run-scoped controller
   * so budget expiry or settlement aborts in-flight sub-calls).
   */
  dispatch?: (call: ToolDispatchCall, signal?: AbortSignal) => Promise<ToolDispatchResult>;
}

/** Internal tool IR; provider adapters map this to wire formats. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Record<string, unknown>, ctx: ToolExecuteContext): Promise<string> | string;
  /**
   * Cooperative per-call timeout budget in milliseconds, enforced by the
   * loop through `ctx.signal` (plus a race fallback). NEVER sent to the
   * model — only name/description/parameters join the request.
   */
  timeoutMs?: number;
  /**
   * Pure synchronous classifier for overlap with sibling tool calls. Only
   * `true` opts in; calls whose classifier returns true may execute in a
   * parallel group with adjacent opted-in calls. Opted-in executions must
   * not mutate shared state and must tolerate concurrent dispatch.
   */
  isConcurrencySafe?(args: Record<string, unknown>): boolean;
  /**
   * Per-call permission classification: overrides the tool's static kind for
   * one specific invocation. Used by fs reads to escalate out-of-workspace
   * paths to the approval-gated `read-external` kind while in-workspace reads
   * stay auto-allowed. May be async: sandbox-aware classifiers resolve real
   * paths (symlinks) before deciding.
   */
  permissionFor?(args: Record<string, unknown>): ToolPermissionKind | Promise<ToolPermissionKind>;
  /**
   * Optional human-readable preview of a call's effect, rendered above
   * approval prompts (e.g. the edit diff of edit_file). Must never mutate
   * state — the caller may invoke it before permission is granted.
   */
  preview?(args: Record<string, unknown>, ctx: { rootDir: string }): Promise<string> | string;
}

/**
 * Approval kinds a tool call can require. `read-external` is a read that
 * reaches outside the workspace root: auto-allowed only in `full` mode,
 * otherwise it goes through the interactive approval gate.
 */
export type ToolPermissionKind = 'read' | 'read-external' | 'write' | 'execute' | 'network';

/** Events emitted by a ChatProvider during a single completion stream. */
export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; argsDelta?: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'finish'; finishReason?: string }
  /**
   * The provider discarded its in-flight response (mid-stream failure) and is
   * re-requesting within its retry budget. Consumers must drop every
   * accumulator fed by this attempt (partial text, tool-call deltas, usage,
   * finish reason) — the retry replays from scratch. Never emitted before the
   * first event of an attempt (those retries are transparent).
   */
  | { type: 'reset'; attempt: number; maxRetries: number; error: string };

export interface ChatRequest {
  messages: AgentMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

/** Provider contract implemented by packages/ai. */
export interface ChatProvider {
  stream(req: ChatRequest): AsyncIterable<StreamEvent>;
}

export interface ToolCallVerdict {
  action: 'allow' | 'deny' | 'rewrite';
  /** For 'rewrite': replacement arguments to execute with. */
  args?: Record<string, unknown>;
  /** For 'deny': human-readable reason surfaced to the model. */
  reason?: string;
}

/**
 * Interception points of the agent loop. The plugin host composes all
 * plugin-registered hooks into one AgentHooks implementation.
 */
export interface AgentHooks {
  /** Chain: each hook may rewrite the request before it reaches the provider. */
  beforeLLMCall?(req: ChatRequest): Promise<ChatRequest>;
  /** Permission gate / arg rewrite before a tool executes. */
  beforeToolCall?(call: ToolCall): Promise<ToolCallVerdict>;
  /** Transform a tool result before it enters the message log. */
  afterToolResult?(call: ToolCall, result: string): Promise<string>;
}

/** Events yielded by the agent loop for consumers (REPL, TUI, CI runner). */
export type AgentEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'text_delta'; messageId: string; text: string }
  /**
   * Streamed chain-of-thought / reasoning content (e.g. DeepSeek
   * `reasoning_content`). Never persisted into the message log — it is
   * observability only, so the provider prefix cache stays stable.
   */
  | { type: 'reasoning_delta'; text: string }
  | { type: 'message'; message: AssistantMessage }
  | { type: 'tool_call_start'; turn: number; call: ToolCall }
  | { type: 'tool_call_result'; turn: number; call: ToolCall; result: ToolResultMessage }
  | { type: 'usage'; usage: Usage; stats: UsageStats }
  /**
   * Emitted once when a run ends via user abort, after the marker message has
   * been appended to the log. Consumers should persist `message` (codex-style
   * <turn_aborted> marker) so the model learns the turn was cut short.
   */
  | { type: 'turn_aborted'; message: UserMessage }
  /**
   * The provider's in-flight response failed mid-stream and is being
   * re-requested (attempt N of maxRetries). The loop has already rolled back
   * its accumulators and usage stats (`stats` carries the corrected
   * cumulative numbers); UIs discard partial output rendered for the failed
   * attempt.
   */
  | { type: 'llm_retry'; attempt: number; maxRetries: number; error: string; stats: UsageStats }
  | { type: 'done'; stopReason: 'complete' | 'max_turns' | 'aborted' };
