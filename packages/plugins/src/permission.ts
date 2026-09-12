import type { ToolCall } from '@nova-agent/core';
import type { PermissionKind } from './types.js';

export type ApprovalMode = 'read-only' | 'auto-edit' | 'full';
export type AskAnswer = 'allow' | 'deny' | 'always';
export type AskFn = (call: ToolCall, kind: PermissionKind) => Promise<AskAnswer>;

/**
 * Session-level policy applied BEFORE any interactive answerer runs
 * (dsh-style fail-closed vocabulary):
 * - 'ask' — delegate to the composed asker (TUI modal / readline prompt).
 * - 'never' — deterministically deny every ask without dispatching any
 *   asker. The strict headless stance (exec/CI): the outcome is knowable
 *   without asking, and a later-registered asker cannot bypass it.
 */
export type ApprovalPolicy = 'ask' | 'never';

export interface ApprovalAudit {
  toolName: string;
  kind: PermissionKind;
  outcome: AskAnswer;
}

/**
 * Three-tier approval (codex-style):
 * - read-only: reads auto-allowed; write/execute/network ask
 * - auto-edit: reads + workspace writes auto-allowed; execute/network ask
 * - full: everything allowed
 *
 * An "always" answer is remembered for the rest of the session, scoped to
 * WHAT was approved (dsh's allowed-once lesson, one notch looser):
 * - execute tools are remembered by the command's program prefix
 *   (`exec:git`), so `git status` approves later `git ...` commands but not
 *   `rm -rf`;
 * - other kinds are remembered per tool name + kind.
 *
 * All failure modes fail closed: a throwing asker or an invalid answer
 * denies the call instead of opening the gate.
 */
export class PermissionService {
  /** Remembered grants, keyed by scope (see rememberKey). */
  private readonly remembered = new Set<string>();
  private mode: ApprovalMode;
  private policy: ApprovalPolicy = 'ask';

  constructor(
    mode: ApprovalMode,
    private readonly ask: AskFn,
    private readonly audit?: (entry: ApprovalAudit) => void,
  ) {
    this.mode = mode;
  }

  get approvalMode(): ApprovalMode {
    return this.mode;
  }

  /** Runtime switch (e.g. the /approvals command). */
  setMode(mode: ApprovalMode): void {
    this.mode = mode;
  }

  /** Non-interactive deployments set this once; 'never' short-circuits every ask. */
  setPolicy(policy: ApprovalPolicy): void {
    this.policy = policy;
  }

  get approvalPolicy(): ApprovalPolicy {
    return this.policy;
  }

  private autoAllows(kind: PermissionKind): boolean {
    if (this.mode === 'full') return true;
    if (kind === 'read') return true;
    // Reads reaching outside the workspace root are gated in every mode
    // except `full`: the sandbox boundary is exactly what they cross.
    if (kind === 'read-external') return false;
    if (kind === 'write') return this.mode === 'auto-edit';
    return false;
  }

  /**
   * The scope an "always" grant covers for this call: a bare command is
   * remembered per program prefix; a COMPOUND command — one chaining commands
   * with `&&`/`;`/`|` (or `&`) — is remembered as the whole normalized
   * command. Granting `exec:cd` from `cd x && rm -rf .` would let any `cd`
   * skip the gate, so compound chains stay single-shot: only that exact chain
   * (modulo whitespace) is re-granted.
   */
  private rememberKey(toolName: string, kind: PermissionKind, call: ToolCall): string {
    if (kind === 'execute') {
      const command = typeof call.args['command'] === 'string' ? call.args['command'].trim() : '';
      if (command.length > 0) {
        if (/[&;|]/.test(command)) return `exec:${command.replace(/\s+/g, ' ')}`;
        const program = (command.split(/\s+/)[0] ?? '').toLowerCase();
        if (program.length > 0) return `exec:${program}`;
      }
    }
    return `${toolName}:${kind}`;
  }

  async check(toolName: string, kind: PermissionKind, call: ToolCall): Promise<'allow' | 'deny' | 'ask'> {
    if (this.remembered.has(this.rememberKey(toolName, kind, call))) return 'allow';
    if (this.autoAllows(kind)) return 'allow';
    return 'ask';
  }

  async decide(toolName: string, kind: PermissionKind, call: ToolCall): Promise<'allow' | 'deny'> {
    const verdict = await this.check(toolName, kind, call);
    if (verdict !== 'ask') return verdict === 'allow' ? 'allow' : 'deny';

    // 'never' never dispatches an asker — even one registered later.
    let answer: AskAnswer;
    if (this.policy === 'never') {
      answer = 'deny';
    } else {
      try {
        const raw = await this.ask(call, kind);
        answer = raw === 'allow' || raw === 'deny' || raw === 'always' ? raw : 'deny';
      } catch {
        answer = 'deny';
      }
    }

    if (answer === 'always') this.remembered.add(this.rememberKey(toolName, kind, call));
    this.audit?.({ toolName, kind, outcome: answer });
    return answer === 'deny' ? 'deny' : 'allow';
  }
}
