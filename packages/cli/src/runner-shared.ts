/**
 * Shared runner Estate: the three runners (tui / repl / exec) previously
 * hand-wrote the same timing map, maxTurns hint, toast thresholds and
 * approval-service assembly. One source here, three thin call sites.
 */

import type {
  AgentHooks,
  AgentMessage,
  AgentOptions,
  ChatProvider,
  ChatRequest,
  JobRegistry,
  Session,
  ToolDefinition,
  Usage,
} from '@nova-agent/core';
import { DEFAULT_MAX_TURNS } from '@nova-agent/core';
import path from 'node:path';
import { PermissionService, type ApprovalMode, type AskFn } from '@nova-agent/plugins';
import { EXEC_DONE_NOTIFY_MS, LONG_TASK_DONE_MS, LONG_TASK_ERROR_MS } from '@nova-agent/tui-view';
import { shouldCompactBefore } from './auto-compact.js';
import { novaHome, type Config } from './config.js';
import type { CompactedSession } from './compact.js';

/** Per-call start timestamps keyed by tool call id (parallel-safe). */
export class ToolTiming {
  private readonly starts = new Map<string, number>();

  start(callId: string): void {
    this.starts.set(callId, Date.now());
  }

  /** Elapsed ms since start; 0 when the start was never seen. Unknown-safe. */
  finish(callId: string): number {
    const started = this.starts.get(callId) ?? 0;
    this.starts.delete(callId);
    return Math.max(0, started === 0 ? 0 : Date.now() - started);
  }
}

/** Shared maxTurns ceiling hint (was copy-pasted in repl + tui). */
export function maxTurnsHint(config: Config): string {
  return `  已达 maxTurns 上限（当前 ${config.maxTurns ?? DEFAULT_MAX_TURNS}，可在 ~/.nova/config.json 调大后 /resume 继续）`;
}

/** Long-task toast thresholds shared by repl + tui. */
export const LONG_TASK = {
  errorMs: LONG_TASK_ERROR_MS,
  doneMs: LONG_TASK_DONE_MS,
  execDoneMs: EXEC_DONE_NOTIFY_MS,
} as const;

/** Approval service + log-only audit trail (survives resume via the log). */
export function createApprovalService(
  approvalMode: ApprovalMode,
  askApproval: AskFn,
  session: Session,
): PermissionService {
  return new PermissionService(approvalMode, askApproval, (entry) => {
    void session
      .appendEvent({ type: 'approval', toolName: entry.toolName, kind: entry.kind, outcome: entry.outcome, at: Date.now() })
      .catch(() => {});
  });
}

/**
 * REPL/TUI approval prompt copy. The always-grant scope note only applies to
 * execute-class calls (program-prefix memory); other kinds omit it.
 */
export function approvalPrompt(
  permission: string,
  tool: string,
  argsPreview: string,
  kind: string,
): { prompt: string; alwaysScopeNote: string } {
  return {
    prompt: `允许${permission} · ${tool} ${argsPreview} [y] 本次允许 / [a] 总是允许 / [n] 拒绝：`,
    alwaysScopeNote:
      kind === 'execute'
        ? '（always 按命令程序前缀记忆，如 git status → 放行后续 git …；含 &&/;/| 的复合命令只按整条放行）'
        : '',
  };
}

/**
 * Shared auto-compact orchestration for the interactive runners (repl / tui).
 * exec differs fundamentally (no user-message boundary → per-request
 * wrapAutoCompact); repl and tui hand-wrote the same three pieces — runCompact
 * (running-guard + anchor reset), the pre-flight check and the post-turn
 * fallback — with only the presentation differing. One contract here: which
 * guards run in which order, when the anchors reset, how a failed compaction
 * is contained. Runners inject their state through accessors (their `messages`
 * binding rebinds on adopt) and their presentation through report callbacks.
 */
export interface AutoCompactDeps {
  /** Token threshold; undefined disables both auto paths (manual /compact stays). */
  limit: number | undefined;
  /** Live request-image inputs, read fresh per check (host/messages rebind). */
  request: () => { messages: AgentMessage[]; systemPrompt?: string; tools: ChatRequest['tools'] };
  state: {
    isRunning(): boolean;
    setRunning(running: boolean): void;
    anchors(): { usageAnchor: Usage | undefined; anchorMsgCount: number };
    /** Zero the per-turn usage anchors (cumulative session stats are kept). */
    resetAnchors(): void;
    lastPromptTokens(): number;
    /** Rebind the runner's live surface to the compaction outcome. */
    adoptSurface(surface: AgentMessage[]): void;
  };
  /** The runner's in-place compaction (compactSession with its client/session). */
  compact(trigger: 'auto' | 'manual'): Promise<CompactedSession>;
  report: {
    preStart(limit: number): void;
    postStart(tokens: number, limit: number): void;
    success(outcome: CompactedSession): void;
    failure(err: unknown, where: 'pre' | 'post'): void;
  };
}

export function createAutoCompact(deps: AutoCompactDeps): {
  runCompact(trigger: 'auto' | 'manual'): Promise<CompactedSession>;
  maybePreCompact(): Promise<void>;
  maybeAutoCompact(): Promise<void>;
} {
  const runCompact = async (trigger: 'auto' | 'manual'): Promise<CompactedSession> => {
    deps.state.setRunning(true);
    try {
      const outcome = await deps.compact(trigger);
      // Cumulative session stats (turns, tokens, cache) are NOT reset on
      // compaction — they describe the whole session, not the visible window.
      // Only the per-turn usage anchors reset (the next request starts fresh).
      deps.state.resetAnchors();
      deps.state.adoptSurface(outcome.surface);
      return outcome;
    } finally {
      deps.state.setRunning(false);
    }
  };

  /** Pre-flight: compact BEFORE the next request instead of after an overflow. */
  const maybePreCompact = async (): Promise<void> => {
    if (deps.limit === undefined || deps.state.isRunning()) return;
    const { messages, systemPrompt, tools } = deps.request();
    const { usageAnchor, anchorMsgCount } = deps.state.anchors();
    if (!shouldCompactBefore({ limit: deps.limit, usageAnchor, anchorMsgCount, messages, request: { messages, systemPrompt, tools } }))
      return;
    deps.report.preStart(deps.limit);
    try {
      deps.report.success(await runCompact('auto'));
    } catch (err) {
      // A failed compaction must not kill the turn (agentTurn is invoked
      // fire-and-forget); the conversation continues uncompressed.
      deps.report.failure(err, 'pre');
    }
  };

  /** Fallback: auto-compact AFTER a turn when its prompt tokens exceeded the threshold. */
  const maybeAutoCompact = async (): Promise<void> => {
    if (deps.limit === undefined || deps.state.isRunning()) return;
    const tokens = deps.state.lastPromptTokens();
    if (tokens <= deps.limit) return;
    deps.report.postStart(tokens, deps.limit);
    try {
      deps.report.success(await runCompact('auto'));
    } catch (err) {
      deps.report.failure(err, 'post');
    }
  };

  return { runCompact, maybePreCompact, maybeAutoCompact };
}

/**
 * The runAgent kwargs shared verbatim by all three runners: provider, live
 * message surface, cache-affinity ids, event persistence, tool/hook wiring.
 * The accessors matter — repl/tui rebind `messages`, `host` and `hooks` at
 * runtime (compaction adopts a new surface, rebuildHost re-points tools), so
 * the base must be re-derived at every runAgent call, not captured once.
 * Call sites spread the result and add only their runner-specific bits
 * (signal, onToolProgress).
 */
export function agentRunBase(deps: {
  client: ChatProvider;
  session: Session;
  rootDir: () => string;
  messages: () => AgentMessage[];
  tools: () => ToolDefinition[];
  hooks: () => AgentHooks;
  jobs: JobRegistry;
  systemPrompt?: string;
  maxTurns?: number;
}): () => Pick<
  AgentOptions,
  'provider' | 'messages' | 'rootDir' | 'cacheDir' | 'jobs' | 'emit' | 'tools' | 'hooks' | 'systemPrompt' | 'maxTurns'
> {
  return () => ({
    provider: deps.client,
    messages: deps.messages(),
    rootDir: deps.rootDir(),
    // Spilled tool outputs are grouped per session (id is globally unique).
    cacheDir: path.join(novaHome(), 'cache', 'tool-outputs', deps.session.id),
    jobs: deps.jobs,
    emit: async (evt) => {
      await deps.session.appendEvent(evt);
    },
    tools: deps.tools(),
    hooks: deps.hooks(),
    systemPrompt: deps.systemPrompt,
    maxTurns: deps.maxTurns,
  });
}
