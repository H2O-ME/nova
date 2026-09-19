/**
 * Approval vocabulary (moved out of the plugins package for the surface
 * rewrite): the answer shapes a human gives a gated tool call live in
 * `plugins/permission.ts`, but the KERNEL event stream carries them too
 * (`approval_request` / `resolveApproval`), and core must not import plugins.
 *
 * The engine (three-tier modes, remembered grants, fail-closed normalization)
 * stays in plugins' `PermissionService`; this file owns the vocabulary and the
 * `ApprovalBroker` — the request/response seam an `AgentSession` uses to ask a
 * remote or local surface and wait for its answer as an event on the stream.
 */
import { newId } from './ids.js';
import type { ToolCall, ToolPermissionKind } from './types.js';
import type { ToolCallView } from './presentation.js';

export type ApprovalMode = 'read-only' | 'auto-edit' | 'full';
export type AskAnswer = 'allow' | 'deny' | 'always';
/**
 * An "always" answer carrying an explicit grant scope: the answerer may pin
 * the memory to the FIRST N WORDS of the command instead of the default
 * program prefix. Validated against the actual call by the permission engine;
 * an out-of-range N falls back to the default scope.
 */
export interface AlwaysGrant {
  answer: 'always';
  scopeWords: number;
}
/**
 * A denial carrying the reason the user typed — the reason rides into the
 * tool result so the model receives the instruction, not a bare denial.
 */
export interface DenyGrant {
  answer: 'deny';
  reason: string;
}
export type AskResult = AskAnswer | AlwaysGrant | DenyGrant;
export type AskFn = (call: ToolCall, kind: ToolPermissionKind) => Promise<AskResult>;
/** decideDetailed's verdict: deny may carry the user-typed reason. */
export type DecideResult = 'allow' | { decision: 'deny'; reason?: string };
/**
 * Session-level policy applied BEFORE any interactive answerer runs:
 * 'ask' delegates to the composed asker; 'never' deterministically denies
 * every ask without dispatching any asker (strict headless stance).
 */
export type ApprovalPolicy = 'ask' | 'never';

export interface ApprovalAudit {
  toolName: string;
  kind: ToolPermissionKind;
  outcome: AskAnswer;
}

/**
 * The minimal permission-engine contract an `AgentSession` speaks. plugins'
 * `PermissionService` implements it structurally; a surface that assembles its
 * own engine can hand the session the same shape (mode readout + switching).
 */
export interface PermissionPort {
  readonly approvalMode: ApprovalMode;
  readonly approvalPolicy: ApprovalPolicy;
  setMode(mode: ApprovalMode): void;
  setPolicy(policy: ApprovalPolicy): void;
}

/** One outstanding approval: everything a surface needs to render the ask. */
export interface ApprovalRequest {
  /** Correlation id; the answer comes back via `AgentSession.resolveApproval`. */
  id: string;
  call: ToolCall;
  kind: ToolPermissionKind;
  /** Render intent of the call (presentation vocabulary), when the tool declares one. */
  view?: ToolCallView;
  /** Post-args effect preview lines (e.g. edit_file's diff), best-effort. */
  preview?: string[];
}

/** Where a pending approval's wait ended. */
export type ApprovalResolution =
  | { source: 'user'; answer: AskResult }
  | { source: 'aborted' }
  | { source: 'closed' };

/**
 * Request/response bridge between the permission engine's `ask` seam and the
 * kernel's event stream: the asker publishes an `ApprovalRequest`, the surface
 * answers by id, and every outstanding waiter resolves — including fail-closed
 * denials when the run aborts or the session closes with asks outstanding.
 *
 * Serialization of concurrent asks (the modal collision guard) lives in
 * `PermissionService.enqueueAsk`, not here: by the time the broker sees an
 * ask, the engine has already dequeued it one at a time.
 */
export class ApprovalBroker {
  private readonly pending = new Map<string, (r: AskResult) => void>();
  private readonly requests = new Map<string, ApprovalRequest>();
  /** Installed by the owning AgentSession; called for live surfaces only. */
  private publish: ((request: ApprovalRequest) => void) | undefined;
  private resolved: ((id: string, resolution: ApprovalResolution) => void) | undefined;
  private closed = false;

  constructor(
    private readonly viewFor: (call: ToolCall) => ToolCallView | undefined,
    private readonly previewFor?: (call: ToolCall, kind: ToolPermissionKind) => Promise<string[]>,
  ) {}

  attach(
    publish: (request: ApprovalRequest) => void,
    onResolved: (id: string, resolution: ApprovalResolution) => void,
  ): void {
    this.publish = publish;
    this.resolved = onResolved;
  }

  /** Outstanding requests in ask order (a reconnecting surface re-renders these). */
  outstanding(): ApprovalRequest[] {
    return [...this.requests.values()];
  }

  /** The `AskFn` to hand a `PermissionService`. */
  readonly asker: AskFn = async (call, kind) => {
    if (this.closed) return 'deny';
    const view = this.viewFor(call);
    const request: ApprovalRequest = {
      id: newId('apr'),
      call,
      kind,
      ...(view !== undefined ? { view } : {}),
    };
    // Effect preview is best-effort and rides BEFORE the prompt surfaces, so
    // an approval modal can show what the call WILL do, not just its args.
    if (this.previewFor !== undefined) {
      try {
        const lines = await this.previewFor(call, kind);
        if (lines.length > 0) request.preview = lines;
      } catch {
        // preview failure never blocks the ask
      }
    }
    if (this.closed) return 'deny';
    this.pending.set(request.id, () => undefined);
    this.requests.set(request.id, request);
    this.publish?.(request);
    return new Promise<AskResult>((resolve) => {
      this.pending.set(
        request.id,
        (answer) => resolve(answer),
      );
    });
  };

  /** Answer one outstanding request. Unknown/closed ids return false. */
  resolve(id: string, answer: AskResult): boolean {
    const settle = this.pending.get(id);
    if (settle === undefined) return false;
    this.pending.delete(id);
    this.requests.delete(id);
    settle(answer);
    this.resolved?.(id, { source: 'user', answer });
    return true;
  }

  /**
   * Fail-closed sweep: every outstanding ask resolves as deny. 'aborted' is
   * per-run (the session can keep asking next turn); 'closed' is terminal.
   */
  failAll(reason: 'aborted' | 'closed'): void {
    if (reason === 'closed') this.closed = true;
    for (const settle of this.pending.values()) {
      settle('deny');
    }
    this.pending.clear();
    const ids = [...this.requests.keys()];
    this.requests.clear();
    for (const id of ids) {
      this.resolved?.(id, { source: reason });
    }
  }
}
