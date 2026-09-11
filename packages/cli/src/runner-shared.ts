/**
 * Shared runner Estate: the three runners (tui / repl / exec) previously
 * hand-wrote the same timing map, maxTurns hint, toast thresholds and
 * approval-service assembly. One source here, three thin call sites.
 */

import type { Session } from '@nova-agent/core';
import { DEFAULT_MAX_TURNS } from '@nova-agent/core';
import { PermissionService, type ApprovalMode, type AskFn } from '@nova-agent/plugins';
import { EXEC_DONE_NOTIFY_MS, LONG_TASK_DONE_MS, LONG_TASK_ERROR_MS } from '@nova-agent/tui-view';
import type { Config } from './config.js';

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
      kind === 'execute' ? '（always 按命令程序前缀记忆，如 git status → 放行后续 git …）' : '',
  };
}
