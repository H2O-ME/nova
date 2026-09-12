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
  /**
   * Serialization point for the ask path: concurrent decide() calls dispatch
   * their asker ONE AT A TIME. Without this, PTC run_code's parallel sub-calls
   * race for the TUI approval modal — each ask overwrites `store.approval`,
   * the displaced promise never resolves, and the run hangs forever. Verdict
   * short-circuits (remembered / auto-allow / 'never') bypass the chain.
   */
  private askChain: Promise<unknown> = Promise.resolve();

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
   * remembered per program prefix; a COMPOUND command is remembered as the
   * whole normalized command. Compound means explicit chaining (`&&`/`;`/`|`
   * /`&`), newline chains (bash executes lines sequentially — a multi-line
   * `echo\nrm -rf` would otherwise be remembered as plain `exec:echo`) AND
   * command substitution (`$(...)`/backtick: the user approved a program, not
   * an arbitrary payload it happens to interpolate). Granting `exec:cd` from
   * `cd x && rm -rf .` would let any `cd` skip the gate, so these stay
   * single-shot: only that exact command (modulo whitespace) is re-granted.
   */
  private rememberKey(toolName: string, kind: PermissionKind, call: ToolCall): string {
    if (kind === 'execute') {
      const command = typeof call.args['command'] === 'string' ? call.args['command'].trim() : '';
      if (command.length > 0) {
        const compound = /[&;|\n\r]/.test(command) || command.includes('$(') || command.includes('`');
        if (compound) return `exec:${command.replace(/\s+/g, ' ')}`;
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

    const answer = await this.enqueueAsk(call, kind);

    if (answer === 'always') this.remembered.add(this.rememberKey(toolName, kind, call));
    this.audit?.({ toolName, kind, outcome: answer });
    return answer === 'deny' ? 'deny' : 'allow';
  }

  /**
   * One serialized ask: queued behind every prior ask (each with its own
   * captured call/kind), immune to a previous asker's failure. 'never'
   * short-circuits; a throwing asker or an invalid answer denies.
   */
  private enqueueAsk(call: ToolCall, kind: PermissionKind): Promise<AskAnswer> {
    const dispatch = (): AskAnswer | Promise<AskAnswer> => {
      if (this.policy === 'never') return 'deny';
      return this.ask(call, kind)
        .then((raw) => (raw === 'allow' || raw === 'deny' || raw === 'always' ? raw : 'deny'))
        .catch(() => 'deny' as AskAnswer);
    };
    const run = this.askChain.then(dispatch, dispatch);
    this.askChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
