/**
 * runAgent 的选项面与循环族共享常量（M9.6 阶段 G 拆分的基础层）。
 * 单列一层是为了让 notices/request/stream/tools 只向下依赖、不成环；
 * 公共 API 面经由 `agent.ts` 桶文件原样再导出。
 */
import type {
  AgentHooks,
  AgentMessage,
  ChatProvider,
  ToolDefinition,
  ToolDispatchCall,
  ToolDispatchResult,
  UsageStats,
} from '../types.js';
import type { JobRegistry } from '../jobs.js';

/** The nested-dispatch seam exposed to tools through ToolExecuteContext. */
export type ToolDispatcher = (call: ToolDispatchCall, signal?: AbortSignal) => Promise<ToolDispatchResult>;

/**
 * Empty-completion re-issues per turn before the run errors out (see the
 * retry loop in runAgent): 1 real attempt + 2 retries.
 */
export const EMPTY_COMPLETION_MAX_RETRIES = 2;

export interface AgentOptions {
  provider: ChatProvider;
  /** Append-only message log; the loop appends new messages to this array. */
  messages: AgentMessage[];
  rootDir: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** Loop interception points; the plugin host composes plugins into this. */
  hooks?: AgentHooks;
  maxTurns?: number;
  /** Tool results larger than this are offloaded to cacheDir. */
  maxToolResultBytes?: number;
  cacheDir?: string;
  /** Background-job registry exposed to tools through ToolExecuteContext. */
  jobs?: JobRegistry;
  /** Session-event sink exposed to tools (log-only events like todo/write). */
  emit?: (evt: import('../session.js').SessionEvent) => void | Promise<void>;
  /**
   * Live progress feed from long-running tools (bash stdout tail etc.).
   * Purely presentational: the loop never waits on it and drops it silently
   * when unset.
   */
  onToolProgress?: (text: string) => void;
  signal?: AbortSignal;
}

/** Exported so UIs can display the effective limit in hints. */
export const DEFAULT_MAX_TURNS = 30;
export const DEFAULT_MAX_TOOL_RESULT_BYTES = 40 * 1024;
/** How long a running tool may keep the turn open after the user aborted. */
export const ABORT_GRACE_MS = 2_000;

/**
 * Appended to the log when a run is cut short by abort (codex-style
 * <turn_aborted> marker): without it the model has no way to learn that the
 * previous turn ended mid-work and that tools may have partially executed.
 */
export const TURN_ABORTED_GUIDANCE =
  'The user interrupted the previous turn on purpose. It may have ended mid-task: tools or commands from that turn might have partially executed, so verify the current state before continuing.';

export const SKIPPED_BY_ABORT = '[not executed: the user interrupted this turn]';

/**
 * Synthesized for tool calls whose result never landed because the consumer
 * abandoned the run mid-turn (runner event handler threw → for-await called
 * .return() on this generator). Keeps the one-result-per-call contract: an
 * assistant message with unanswered tool_calls would 400 the next request on
 * strict providers and stay unbalanced across resume/compact.
 */
export const NOT_EXECUTED_GUIDANCE = '[not executed: the turn ended before this call ran]';

export function emptyStats(): UsageStats {
  return { turns: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, missTokens: 0, missTurns: 0 };
}

/**
 * Per-turn misses at or below this are breakpoint-granularity noise (pi
 * cache-stats), not a real prefix invalidation.
 */
export const CACHE_MISS_NOISE_FLOOR_TOKENS = 1024;

/**
 * Appended to the log for every tool call of an assistant message that was
 * cut off by the output token limit (pi-style length defense): streamed
 * arguments are salvaged best-effort, so they may parse and validate but be
 * silently incomplete. None of the batch is safe to execute; failing them all
 * lets the model re-issue complete calls instead of wasting a turn on a
 * half-specified command.
 */
export const LENGTH_CUTOFF_TOOL_GUIDANCE =
  'not executed: the response hit the output token limit, so the arguments may be truncated. Re-issue the tool call with complete arguments.';
