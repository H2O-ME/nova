import type { ToolCall } from '@nova-agent/core';
import type { PermissionKind } from './types.js';

export type ApprovalMode = 'read-only' | 'auto-edit' | 'full';
export type AskAnswer = 'allow' | 'deny' | 'always';
/**
 * An "always" answer carrying an explicit grant scope (Grok 组件6 port): the
 * answerer may pin the memory to the FIRST N WORDS of the command instead of
 * the default program prefix. Validated against the actual call in decide();
 * an out-of-range N silently falls back to the default scope.
 */
export interface AlwaysGrant {
  answer: 'always';
  scopeWords: number;
}
/**
 * A denial carrying the reason the user typed on the reject row (组件7,
 * Grok reject-to-followup): the reason rides into the tool result so the
 * model receives the instruction instead of a bare "Permission denied".
 */
export interface DenyGrant {
  answer: 'deny';
  reason: string;
}
export type AskResult = AskAnswer | AlwaysGrant | DenyGrant;
export type AskFn = (call: ToolCall, kind: PermissionKind) => Promise<AskResult>;
/** decideDetailed's verdict: deny may carry the user-typed reason. */
export type DecideResult = 'allow' | { decision: 'deny'; reason?: string };

/** Chaining/substitution markers — a command containing them grants whole-command memory only. */
function isCompoundCommand(command: string): boolean {
  return /[&;|\n\r]/.test(command) || command.includes('$(') || command.includes('`');
}

/**
 * The word list an execute command can scope an "always" grant over:
 * a bare (non-compound) command's tokens; [] for compound commands,
 * where only whole-command memory is safe (no meaningful word prefix).
 */
export function alwaysScopeWords(command: unknown): string[] {
  if (typeof command !== 'string') return [];
  const trimmed = command.trim();
  if (trimmed.length === 0 || isCompoundCommand(trimmed)) return [];
  return trimmed.split(/\s+/);
}

/** Fail-closed normalization: anything malformed denies the call. */
function normalizeAsk(raw: unknown): AskResult {
  if (raw === 'allow' || raw === 'deny') return raw;
  if (raw === 'always') return raw;
  if (typeof raw === 'object' && raw !== null) {
    const grant = raw as { answer?: unknown; scopeWords?: unknown; reason?: unknown };
    if (grant.answer === 'always' && Number.isInteger(grant.scopeWords) && (grant.scopeWords as number) >= 1) {
      return { answer: 'always', scopeWords: grant.scopeWords as number };
    }
    if (grant.answer === 'deny') {
      if (typeof grant.reason !== 'string') return 'deny';
      const reason = grant.reason.trim().slice(0, 400);
      return reason.length > 0 ? { answer: 'deny', reason } : 'deny';
    }
  }
  return 'deny';
}

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
 * An asker may pin the scope tighter/looser (组件6, Grok 可调 always 范围):
 * `alwaysScopeWords` 给出可选词数，`{answer:'always', scopeWords:N}` 把记忆
 * 钉在命令前 N 词（`git status` → 放行 `git status …`，不波及 `git commit`）。
 * N 越界或命令是复合式时回落默认范围——授权范围永远由引擎校验，不由询问器自定。
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
        if (isCompoundCommand(command)) return `exec:${command.replace(/\s+/g, ' ')}`;
        const program = (command.split(/\s+/)[0] ?? '').toLowerCase();
        if (program.length > 0) return `exec:${program}`;
      }
    }
    return `${toolName}:${kind}`;
  }

  /**
   * The grant scope the user pinned with ←/→ (组件6): first N words of the
   * command, program lowercased like the default key. undefined when N runs
   * past the words or the command has no word-prefix semantics (compound).
   */
  private scopeKey(kind: PermissionKind, call: ToolCall, n: number): string | undefined {
    if (kind !== 'execute') return undefined;
    const words = alwaysScopeWords(call.args['command']);
    if (words.length === 0 || n > words.length) return undefined;
    const [first, ...rest] = words;
    return `exec:${[(first ?? '').toLowerCase(), ...rest.slice(0, n - 1)].join(' ')}`;
  }

  /** Any remembered word-prefix (2..N words) covering this bare command. */
  private scopeHit(call: ToolCall): boolean {
    const words = alwaysScopeWords(call.args['command']);
    for (let n = 2; n <= words.length; n++) {
      if (this.remembered.has(this.scopeKey('execute', call, n) ?? '')) return true;
    }
    return false;
  }

  async check(toolName: string, kind: PermissionKind, call: ToolCall): Promise<'allow' | 'deny' | 'ask'> {
    if (this.remembered.has(this.rememberKey(toolName, kind, call))) return 'allow';
    if (kind === 'execute' && this.scopeHit(call)) return 'allow';
    if (this.autoAllows(kind)) return 'allow';
    return 'ask';
  }

  async decide(toolName: string, kind: PermissionKind, call: ToolCall): Promise<'allow' | 'deny'> {
    const result = await this.decideDetailed(toolName, kind, call);
    return result === 'allow' ? 'allow' : 'deny';
  }

  /**
   * decide() with the user-typed deny reason preserved end to end (组件7):
   * the host folds it into the hook verdict so the model sees the actual
   * instruction, not a bare "Permission denied: by user".
   */
  async decideDetailed(toolName: string, kind: PermissionKind, call: ToolCall): Promise<DecideResult> {
    const verdict = await this.check(toolName, kind, call);
    if (verdict !== 'ask') return verdict === 'allow' ? 'allow' : { decision: 'deny' };

    const result = await this.enqueueAsk(call, kind);
    const answer: AskAnswer = typeof result === 'string' ? result : result.answer;
    if (answer === 'always') {
      const scoped = typeof result === 'object' && result.answer === 'always' ? result.scopeWords : 1;
      this.remembered.add(this.scopeKey(kind, call, scoped) ?? this.rememberKey(toolName, kind, call));
    }
    this.audit?.({ toolName, kind, outcome: answer });
    if (answer !== 'deny') return 'allow';
    return typeof result === 'object' && result.answer === 'deny' ? { decision: 'deny', reason: result.reason } : { decision: 'deny' };
  }

  /**
   * One serialized ask: queued behind every prior ask (each with its own
   * captured call/kind), immune to a previous asker's failure. 'never'
   * short-circuits; a throwing asker or an invalid answer denies.
   */
  private enqueueAsk(call: ToolCall, kind: PermissionKind): Promise<AskResult> {
    const dispatch = (): AskResult | Promise<AskResult> => {
      if (this.policy === 'never') return 'deny';
      return this.ask(call, kind).then(normalizeAsk).catch(() => 'deny' as AskResult);
    };
    const run = this.askChain.then(dispatch, dispatch);
    this.askChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
