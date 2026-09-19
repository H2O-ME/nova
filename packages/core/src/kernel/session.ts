/**
 * `AgentSession` — the kernel handle a surface drives.
 *
 * This is where the old per-runner assembly contract converges into one
 * owner: the event pump, the durable log ("model-visible means logged" is
 * enforced HERE, not by each shell's bookkeeping), the running-prompt queue
 * (the TUI's queue lane generalized into kernel semantics), phase derivation
 * (surfaces stopped guessing "is it thinking" from delta sequences),
 * approvals as request/response events over the broker, compaction with
 * in-place surface splice + anchor reset, auto-compact pre/post gates, and
 * turn-failure classification after log repair.
 *
 * A surface never writes `messages` or the `Session` log itself; it drives
 * the handle and renders the event stream. That is the seam that makes the
 * TUI / WebUI / bot channels interchangeable plugins of the same kernel.
 */
import { runAgent } from '../agent/loop.js';
import {
  emptyStats,
  NOT_EXECUTED_GUIDANCE,
  type AgentOptions,
} from '../agent/options.js';
import { errMessage } from '../errors.js';
import { newId } from '../ids.js';
import { shouldCompactBefore } from '../auto-compact.js';
import { compactSession, type CompactedSession } from '../compact.js';
import type {
  ApprovalBroker,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalResolution,
  AskResult,
  PermissionPort,
} from '../approval.js';
import type { JobRegistry, JobSnapshot } from '../jobs.js';
import type { Session } from '../session.js';
import type { SubagentProgress } from '../tools/subagent.js';
import type {
  AgentHooks,
  AgentMessage,
  ChatProvider,
  ToolDefinition,
  ToolResultMessage,
  Usage,
  UsageStats,
  UserMessage,
} from '../types.js';
import { EventPump } from './pump.js';
import type { KernelEvent, NoticeCode, TurnPhase } from './protocol.js';

export interface UsageAnchorState {
  lastUsage: Usage | undefined;
  lastPromptTokens: number;
  usageAnchor: Usage | undefined;
  anchorMsgCount: number;
}

function createAnchors(): UsageAnchorState {
  return { lastUsage: undefined, lastPromptTokens: 0, usageAnchor: undefined, anchorMsgCount: 0 };
}

function resetAnchors(a: UsageAnchorState): void {
  a.lastUsage = undefined;
  a.lastPromptTokens = 0;
  a.usageAnchor = undefined;
  a.anchorMsgCount = 0;
}

export interface AgentSessionDeps {
  /** Durable append-only log (JSONL v2). */
  session: Session;
  /** Live model surface; this array object is OWNED and spliced in place. */
  messages: AgentMessage[];
  provider: ChatProvider;
  rootDir: () => string;
  tools: () => ToolDefinition[];
  /** Hook chain accessor — re-read per run (the host may rebuild between runs). */
  hooks: () => AgentHooks;
  jobs: JobRegistry;
  /** Approval request/response bridge (its asker was handed to PermissionService). */
  approvals: ApprovalBroker;
  /** Permission engine view (mode readout/switch); omit for headless-never. */
  permission?: PermissionPort;
  systemPrompt?: string;
  maxTurns?: number;
  /** Spill dir for oversized tool results. */
  cacheDir: () => string;
  /** Auto-compact threshold (prompt tokens); omit to disable all gates. */
  autoCompactLimit?: number;
  /**
   * Headless single-run mode: the boundary gates (pre/post) are useless when
   * one run spans the whole task — the assembly layer gates INSIDE every
   * request by wrapping the composed hooks once (plugins'
   * `wrapHeadlessCompact`); this flag only makes the boundary gates stand
   * down so nobody double-compacts.
   */
  perRequestCompact?: boolean;
}

export type AgentStatus = 'idle' | 'running' | 'compacting';

/**
 * Repair an abandoned turn's log (assistant tool_calls without results):
 * synthesize NOT_EXECUTED_GUIDANCE results into the log and fill any hole in
 * the live surface. Idempotent (scans the log), so it is safe to run even
 * when core's own abandonment cleanup already fired.
 */
export async function persistMissingToolResults(
  session: Session,
  messages: AgentMessage[],
): Promise<number> {
  const logged = session.allMessages();
  const loggedResults = new Set<string>();
  for (const msg of logged) {
    if (msg.role === 'tool') loggedResults.add(msg.toolCallId);
  }
  const surfaceResults = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool') surfaceResults.add(msg.toolCallId);
  }
  const missing: ToolResultMessage[] = [];
  for (const msg of logged) {
    if (msg.role !== 'assistant' || msg.toolCalls === undefined) continue;
    for (const call of msg.toolCalls) {
      if (loggedResults.has(call.id)) continue;
      loggedResults.add(call.id);
      missing.push({
        id: newId('msg'),
        ts: Date.now(),
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: NOT_EXECUTED_GUIDANCE,
      });
    }
  }
  for (const result of missing) {
    await session.append(result);
    if (!surfaceResults.has(result.toolCallId)) {
      surfaceResults.add(result.toolCallId);
      messages.push(result);
    }
  }
  return missing.length;
}

export class AgentSession {
  /** The event pump: `subscribe` for callbacks, `events()` for iteration. */
  readonly events: EventPump;
  private readonly deps: AgentSessionDeps;
  private readonly stats: UsageStats = emptyStats();
  private readonly anchors: UsageAnchorState = createAnchors();
  private readonly pending: string[] = [];
  private runController: AbortController | undefined;
  private compactAbort: AbortController | undefined;
  private compacting = false;
  private phase: TurnPhase = 'idle';
  private lastToolCallId: string | undefined;
  private closed = false;

  constructor(deps: AgentSessionDeps) {
    this.deps = deps;
    this.events = new EventPump();
    deps.approvals.attach(
      (request) => {
        this.setPhase('waiting_approval');
        this.publish({ type: 'approval_request', request });
      },
      (id: string, resolution: ApprovalResolution) => {
        this.publish({ type: 'approval_resolved', id, resolution });
        // The modal is gone; if the run is still open, it is back to waiting
        // on the tool it asked about (or idle when the run unwound with it).
        if (this.approvalsBusy()) return;
        this.setPhase(this.running ? 'tool' : 'idle');
      },
    );
  }

  /** The durable log (surfaces read it; writes go through this class). */
  get session(): Session {
    return this.deps.session;
  }

  /** Live model surface (read-only; the class splices it in place on compact). */
  get messages(): readonly AgentMessage[] {
    return this.deps.messages;
  }

  get status(): AgentStatus {
    if (this.compacting) return 'compacting';
    return this.running ? 'running' : 'idle';
  }

  get running(): boolean {
    return this.runController !== undefined;
  }

  get currentPhase(): TurnPhase {
    return this.phase;
  }

  /** Cumulative usage stats (copy; safe to render). */
  usageSnapshot(): UsageStats {
    return { ...this.stats };
  }

  get lastUsage(): Usage | undefined {
    return this.anchors.lastUsage;
  }

  get lastPromptTokens(): number {
    return this.anchors.lastPromptTokens;
  }

  /** Prompts committed while a run was in flight. */
  get queued(): readonly string[] {
    return this.pending;
  }

  get approvalMode(): ApprovalMode | undefined {
    return this.deps.permission?.approvalMode;
  }

  setApprovalMode(mode: ApprovalMode): void {
    this.deps.permission?.setMode(mode);
  }

  setApprovalPolicy(policy: ApprovalPolicy): void {
    this.deps.permission?.setPolicy(policy);
  }

  /** Outstanding approval requests (a reconnecting surface re-renders these). */
  pendingApprovals(): ReturnType<ApprovalBroker['outstanding']> {
    return this.deps.approvals.outstanding();
  }

  /** Subscribe to the kernel event stream (callback view of the pump). */
  subscribe(listener: (event: KernelEvent) => void): () => void {
    return this.events.subscribe(listener);
  }

  /** Operational line from the assembly layer (auto-compact fuse etc.). */
  notice(code: NoticeCode, text: string): void {
    this.publish({ type: 'notice', code, text });
  }

  /** Relay a nested subagent lifecycle moment (wired by the assembly factory). */
  observeSubagent(progress: SubagentProgress): void {
    this.publish({ type: 'subagent_update', progress });
  }

  /** Relay a background-job transition (wired via JobRegistry.setListener). */
  observeJob(job: JobSnapshot): void {
    this.publish({ type: 'job_update', job });
  }

  /**
   * Commit a user prompt (log + `user_message` event) and start a run when
   * idle; when a run is in flight the prompt queues — the NEXT run covers
   * every committed message (they all ride its first request), the queue
   * itself is the pending-trigger ledger surfaces render as the queue lane.
   */
  async prompt(text: string): Promise<void> {
    if (this.closed) throw new Error('agent session is closed');
    const userMsg: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: text };
    this.deps.messages.push(userMsg);
    await this.deps.session.append(userMsg);
    this.publish({ type: 'user_message', message: userMsg });
    if (this.running) {
      this.pending.push(text);
      this.publish({ type: 'queue_update', items: [...this.pending] });
      return;
    }
    void this.runLoop();
  }

  /**
   * Interrupt the current run (or a compaction in progress). Outstanding
   * approvals are fail-closed HERE, not only when the run unwinds: the loop
   * is suspended inside the approval `await` and the abort signal alone never
   * releases it (the old REPL's Ctrl+C cancelled the approval wait for
   * exactly this reason).
   */
  abort(): void {
    if (this.compacting && this.runController === undefined) {
      this.compactAbort?.abort();
      return;
    }
    this.runController?.abort();
    this.deps.approvals.failAll('aborted');
  }

  /** Answer one outstanding approval; false for unknown/consumed ids. */
  resolveApproval(id: string, answer: AskResult): boolean {
    return this.deps.approvals.resolve(id, answer);
  }

  /** Compact now. Rejects while a run is active. */
  async compact(trigger: 'auto' | 'manual' = 'manual'): Promise<CompactedSession> {
    if (this.running) throw new Error('cannot compact while a run is active');
    if (this.compacting) throw new Error('a compaction is already running');
    this.compacting = true;
    this.compactAbort = new AbortController();
    this.setPhase('compacting');
    this.publish({ type: 'compaction', progress: { state: 'start', trigger } });
    try {
      const outcome = await compactSession({
        client: this.deps.provider,
        session: this.deps.session,
        messages: this.deps.messages,
        trigger,
        signal: this.compactAbort.signal,
      });
      // In-place splice: every consumer holds THIS array (the alias contract).
      this.deps.messages.splice(0, this.deps.messages.length, ...outcome.surface);
      resetAnchors(this.anchors);
      this.publish({
        type: 'compaction',
        progress: {
          state: 'done',
          trigger,
          retained: outcome.retained,
          summaryChars: outcome.summary.length,
        },
      });
      return outcome;
    } catch (err) {
      this.publish({
        type: 'compaction',
        progress: { state: 'error', trigger, error: errMessage(err) },
      });
      throw err;
    } finally {
      this.compacting = false;
      this.compactAbort = undefined;
      this.setPhase(this.running ? 'tool' : 'idle');
    }
  }

  /** Close: terminal for prompts, outstanding asks deny, pump drains and ends. */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.abort();
    this.deps.approvals.failAll('closed');
    this.events.close();
  }

  // ---------------------------------------------------------------- internals

  private publish(event: KernelEvent): void {
    this.events.publish(event);
  }

  /**
   * One run, then a flush: queued prompts each start a fresh run after the
   * prior run's post-turn compaction. `runController` is set synchronously at
   * entry, so racing `prompt()` calls see `running` and queue instead of
   * starting a second loop.
   */
  private async runLoop(): Promise<void> {
    if (this.runController !== undefined || this.closed) return;
    const controller = new AbortController();
    this.runController = controller;
    try {
      let flushed: number;
      do {
        await this.startRun(controller.signal);
        if (this.closed) break;
        await this.postTurnCompact();
        flushed = this.pending.length;
        if (flushed > 0) {
          this.pending.length = 0;
          this.publish({ type: 'queue_update', items: [] });
        }
      } while (flushed > 0 && !this.closed && !controller.signal.aborted);
    } finally {
      this.runController = undefined;
      this.setPhase('idle');
    }
  }

  private async startRun(signal: AbortSignal): Promise<void> {
    try {
      await this.preflightCompact();
      const options = this.agentOptions(signal);
      for await (const event of runAgent(options)) {
        await this.consume(event);
      }
    } catch (err) {
      // Repair the log BEFORE classification/propagation — the old trio of
      // persist → repair → classify, now owned by the run loop itself.
      await persistMissingToolResults(this.deps.session, this.deps.messages).catch(() => undefined);
      this.publish({ type: 'run_failed', message: errMessage(err), aborted: signal.aborted });
    } finally {
      // Outstanding asks must not outlive the run that made them.
      this.deps.approvals.failAll('aborted');
    }
  }

  private agentOptions(signal: AbortSignal): AgentOptions {
    const deps = this.deps;
    return {
      provider: deps.provider,
      messages: deps.messages,
      rootDir: deps.rootDir(),
      systemPrompt: deps.systemPrompt,
      tools: deps.tools(),
      hooks: deps.hooks(),
      maxTurns: deps.maxTurns,
      cacheDir: deps.cacheDir(),
      jobs: deps.jobs,
      emit: async (evt) => {
        await deps.session.appendEvent(evt);
      },
      onToolProgress: (text) => {
        this.publish({ type: 'tool_progress', callId: this.lastToolCallId, text });
      },
      signal,
    };
  }

  /** Bookkeeping (durable log), phase derivation and publishing — one pass. */
  private async consume(event: KernelEvent): Promise<void> {
    switch (event.type) {
      case 'turn_start':
      case 'reasoning_delta':
        this.setPhase('thinking');
        break;
      case 'text_delta':
        this.setPhase('writing');
        break;
      case 'tool_call_start':
        this.lastToolCallId = event.call.id;
        this.setPhase('tool');
        break;
      case 'tool_call_result':
        await this.deps.session.append(event.result);
        if (this.lastToolCallId === event.call.id) this.lastToolCallId = undefined;
        this.setPhase(this.approvalsBusy() ? 'waiting_approval' : 'tool');
        break;
      case 'llm_retry':
        this.setPhase('retrying');
        break;
      case 'message':
        await this.deps.session.append(event.message);
        break;
      case 'turn_aborted':
        await this.deps.session.append(event.message);
        break;
      case 'usage': {
        Object.assign(this.stats, event.stats);
        this.anchors.lastUsage = event.usage;
        this.anchors.lastPromptTokens = event.usage.promptTokens;
        // A usage block without prompt_tokens (coerced to 0) must not become
        // the anchor, or the context bar collapses to 0 until the next real
        // report (the old runner-loop guard, same owner now).
        if (event.usage.promptTokens > 0) {
          this.anchors.usageAnchor = event.usage;
          this.anchors.anchorMsgCount = this.deps.messages.length;
        }
        break;
      }
      default:
        break;
    }
    this.publish(event);
  }

  private approvalsBusy(): boolean {
    return this.deps.approvals.outstanding().length > 0;
  }

  private setPhase(phase: TurnPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.publish({ type: 'phase', phase });
  }

  private preflightCompact(): Promise<void> {
    return this.gateCompact('pre');
  }

  private postTurnCompact(): Promise<void> {
    return this.gateCompact('post');
  }

  /** Shared auto-compact contract: which guard runs where (pre = before the
   * first request of a run, post = after a run whose prompt tokens exceeded). */
  private async gateCompact(where: 'pre' | 'post'): Promise<void> {
    const limit = this.deps.autoCompactLimit;
    if (limit === undefined || this.closed || this.deps.perRequestCompact === true) return;
    if (where === 'pre') {
      const { usageAnchor, anchorMsgCount } = this.anchors;
      const due = shouldCompactBefore({
        limit,
        ...(usageAnchor !== undefined ? { usageAnchor } : {}),
        anchorMsgCount,
        messages: this.deps.messages,
        request: {
          messages: this.deps.messages,
          systemPrompt: this.deps.systemPrompt,
          tools: this.deps.tools(),
        },
      });
      if (!due) return;
    } else {
      if (this.anchors.lastPromptTokens <= limit) return;
    }
    try {
      await this.compact('auto');
    } catch (err) {
      // A failed compaction must never kill the turn; report and continue.
      this.notice('compact_failed', `自动压缩失败（继续运行）：${errMessage(err)}`);
    }
  }

  /**
   * The per-request gate for headless single-run tasks lives in the assembly
   * layer (`plugins.createAgentKernel` wraps the composed hooks once); this
   * flag only tells the boundary gates to stand down.
   */
}
