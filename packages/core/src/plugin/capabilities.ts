/**
 * The capability seams — one name per thing the application can replace.
 *
 * The container (`context.ts` / `fiber.ts`) says *how* plugins load; this file
 * says *what they load for*. Every entry is a `ServiceKey` (a provider registers
 * it, consumers declare it in `inject` and read it with `ctx.must(key)`) or an
 * `EventKey` (a lifecycle point others hook into), and each one is a seam an
 * operator can fill from `~/.nova/config.json` without touching source: drop a
 * capability by leaving its provider out, replace one by loading another.
 *
 * The interface next to each key is the contract — deliberately behavioural, not
 * a snapshot of today's implementation: a tool registry can be backed by a
 * sandbox, a compaction service by a cheaper summarizer model, an LLM service by
 * any OpenAI-compatible endpoint. `core` owns these shapes; the provider plugins
 * live where they belong (the `plugins` package for the shipped ones).
 *
 * Two rules keep this list from rotting:
 *  - a key is added only when something already *consumes* it (no speculative
 *    seams), and
 *  - the interface describes what a consumer needs, not what the current
 *    provider happens to have.
 */
import type { DecideResult, PermissionPort } from '../approval.js';
import type { ChatRequest, ToolCall, ToolCallVerdict, ToolDefinition, ToolPermissionKind } from '../types.js';
import type { CompactedSession, CompactSessionOptions } from '../compact.js';
import type { JobRegistry } from '../jobs.js';
import type { AgentSession } from '../kernel/session.js';
import type { AgentSurface, AgentSurfaceRequest } from '../kernel.js';
import type { AskQuestionsFn } from '../user-question.js';
import { event, type EventKey } from './events.js';
import { key, type ServiceKey } from './types.js';

/* ── llm ───────────────────────────────────────────────────────────────── */

/**
 * The model end. `provider` is the wire client the loop streams from; the
 * identity bits are what surfaces display and what the cache-affinity header
 * needs, so a surface never reaches into provider internals.
 */
export interface LlmService {
  readonly provider: import('../types.js').ChatProvider;
  /**
   * Model id in force as the endpoint knows it (display, metadata lookups).
   * LIVE, not a boot-time copy: the provider owns the id (`ChatProvider.model`)
   * and a picker retargets it in place, so a surface that cached this string at
   * boot would keep drawing yesterday's model.
   */
  readonly model: string;
  /**
   * Pin subsequent requests of one session to a cache node. Called by the
   * session plumbing itself, so affinity can no longer be left unbound by a
   * surface that forgot to wire it.
   */
  bindSession(sessionId: string | undefined): void;
}

export const llm: ServiceKey<LlmService> = key<LlmService>('llm');

/* ── tools ─────────────────────────────────────────────────────────────── */

/** One registered tool with its owner and static permission kind. */
export interface ToolEntry {
  plugin: string;
  tool: ToolDefinition;
  permission: ToolPermissionKind;
}

/**
 * The tool registry. Everything the model can call is here, built-in and
 * third-party alike; `register` returns its own undo, so a provider's
 * registration disappears with the fiber that made it.
 */
export interface ToolRegistry {
  /** Live view — read at call time, since later plugins add tools. */
  all(): readonly ToolDefinition[];
  entries(): readonly ToolEntry[];
  find(name: string): ToolDefinition | undefined;
  /**
   * Effective permission kind for one call: the tool's own `permissionFor`
   * classifier wins over the static kind, and a broken classifier fails
   * closed (never silently downgrades to `read`).
   */
  permissionFor(name: string, args?: Record<string, unknown>): Promise<ToolPermissionKind | undefined>;
  /**
   * Register a tool; the returned undo is what an owner ties to its fiber
   * (`ctx.effect(() => registry.register(...))`). `owner` names the plugin the
   * tool belongs to — the loading adapter fills it in, so duplicate-name errors
   * and `/plugins` both name a real plugin rather than the registry.
   */
  register(tool: ToolDefinition, options?: { permission?: ToolPermissionKind; owner?: string }): () => void;
}

export const tools: ServiceKey<ToolRegistry> = key<ToolRegistry>('tools');

/* ── commands ──────────────────────────────────────────────────────────── */

export interface CommandRunContext {
  /** The workspace root the command runs against (re-read each time). */
  rootDir: string;
  log(message: string): void;
}

/** One slash command, provided by a plugin and offered by every surface. */
export interface CommandDefinition {
  /** Slash name without the leading '/'. */
  name: string;
  description: string;
  run(args: string, ctx: CommandRunContext): void | Promise<void>;
}

export interface CommandEntry {
  plugin: string;
  command: CommandDefinition;
}

export interface CommandRegistry {
  all(): readonly CommandDefinition[];
  entries(): readonly CommandEntry[];
  register(command: CommandDefinition): () => void;
}

export const commands: ServiceKey<CommandRegistry> = key<CommandRegistry>('commands');

/* ── approval ──────────────────────────────────────────────────────────── */

/**
 * The gate itself: the mode readout plus the per-call decision. The shipped
 * provider is plugins' `PermissionService`, which satisfies this shape
 * structurally — the seam costs no adapter.
 */
export interface ApprovalService extends PermissionPort {
  /**
   * Decide one call. A denial keeps the reason the user typed, so the model
   * reads the operator's actual instruction rather than a bare "denied".
   */
  decideDetailed(toolName: string, kind: ToolPermissionKind, call: ToolCall): Promise<DecideResult>;
}

export const approval: ServiceKey<ApprovalService> = key<ApprovalService>('approval');

/* ── sessions ──────────────────────────────────────────────────────────── */

/**
 * Session lifecycle: opening, switching and creating handles. One kernel can
 * hold several (a bot channel keeps one per peer), so `current()` is what
 * everything that has to follow "the live conversation" reads.
 */
export interface SessionService {
  current(): AgentSession | undefined;
  open(options?: { resumeFile?: string; sessionDir?: string }): Promise<AgentSession>;
  /** Re-point "current" at an existing handle (peer switch, `/session`). */
  activate(session: AgentSession): void;
}

export const sessions: ServiceKey<SessionService> = key<SessionService>('sessions');

/* ── compaction ────────────────────────────────────────────────────────── */

/**
 * The compaction strategy — the summarizer prompt, retention budget and
 * archive policy behind `/compact` and the auto thresholds. Replaceable as a
 * unit, which is the point: summarization is where the token bill is decided.
 */
export interface CompactionService {
  run(options: CompactSessionOptions): Promise<CompactedSession>;
}

export const compaction: ServiceKey<CompactionService> = key<CompactionService>('compaction');

/* ── jobs ──────────────────────────────────────────────────────────────── */

/** Background work (background bash, subagents). The registry is the seam. */
export const jobs: ServiceKey<JobRegistry> = key<JobRegistry>('jobs');

/* ── spill ─────────────────────────────────────────────────────────────── */

/**
 * Where oversized tool output goes. Only the *destination* is replaceable:
 * the truncation policy (head + hint + tail inside the byte budget) is a
 * message-format contract shared with the log projection, so it stays in core.
 */
export interface SpillService {
  /**
   * Directory for one session's spilled payloads; omit the id for the shared
   * root (that is also the trusted read root the read tool exempts from
   * approval, since the content is what the model already saw).
   */
  dir(sessionId?: string): string;
}

export const spill: ServiceKey<SpillService> = key<SpillService>('spill');

/* ── skills ────────────────────────────────────────────────────────────── */

/**
 * One discovered skill, *index only*: name, description, and which root it came
 * from. The body is deliberately absent — reading a skill is a tool call, which
 * is what keeps skills progressive instead of a boot-time context dump.
 */
export interface SkillInfo {
  name: string;
  description: string;
  source: 'project' | 'user';
}

export interface SkillRegistry {
  all(): readonly SkillInfo[];
  /** Re-scan the roots (after a workspace switch). */
  reload(): Promise<readonly SkillInfo[]>;
}

export const skills: ServiceKey<SkillRegistry> = key<SkillRegistry>('skills');

/* ── user questions ────────────────────────────────────────────────────── */

/**
 * "Can this surface ask a human?" as a service, mirroring dsh's root-level
 * `user-questions` row. The ASK TOOL reads this key at call time instead of
 * being handed an answerer (or nothing) as an assembly option, so:
 *
 *  - a surface with a person registers the provider (it owns the answerer);
 *  - a surface without one leaves the key unprovided, and the tool reports the
 *    typed `NO_PROVIDER` refusal rather than parking a run no card can release;
 *  - the three hand-copied `userQuestions: true` booleans (`kernel-boot`,
 *    `web/controller`, `surface-host`) disappear — the answer is a fact about
 *    the container, not a parameter each assembly site must remember.
 *
 * The provider is a callback, not the broker: the broker is per kernel
 * (`QuestionBroker`) while the DECISION to answer is the surface's. Reading it
 * lazily is what keeps a re-roster from stranding a captured function.
 */
export interface UserQuestionsService {
  /** The answerer, or undefined when this surface has nobody to ask. */
  answerer(): AskQuestionsFn | undefined;
}

export const userQuestions: ServiceKey<UserQuestionsService> = key<UserQuestionsService>('userQuestions');

/* ── surfaces ──────────────────────────────────────────────────────────── */

/**
 * The human-facing end, as a registry: the browser UI, the terminal UI, the bot
 * channel and the headless runners are all implementations of `AgentSurface`,
 * and whoever owns the invocation resolves which one to start by asking this
 * service rather than by an argv if-chain. A third-party surface package
 * registers here exactly like an official one.
 *
 * It is provided INTO the container by the assembly (`surfaceRegistryProvider`
 * in the plugins package), and a surface module named in config becomes a
 * plugin row whose `apply` registers itself here — the same shape every other
 * capability uses. The registry instance is built before the kernel so the
 * roster can load surfaces into the same registry the resolver will read: the
 * object precedes the container, but its PROVIDER does not, and that is what
 * makes a surface an ordinary plugin rather than a special case outside the
 * container. (The earlier revision left this key declared with no provider and
 * called that an honest seam; it was not — it was a registry living outside the
 * container, which is why a surface could not appear in `/plugins`.)
 */
export interface SurfaceRegistry {
  all(): readonly AgentSurface[];
  /** The surface that claims this invocation, in registration order. */
  resolve(request: AgentSurfaceRequest): AgentSurface | undefined;
  register(surface: AgentSurface): () => void;
  /**
   * The surface most recently returned by `resolve` — i.e. the one serving this
   * invocation. Recorded as a side effect of resolving so a consumer that only
   * has the registry (the `userQuestions` service) can answer "does the surface
   * in force have a human?" WITHOUT the resolution result being threaded through
   * the kernel assembly by hand. Undefined before the first resolve, which is
   * the correct fail-closed answer.
   */
  current(): AgentSurface | undefined;
}

export const surfaces: ServiceKey<SurfaceRegistry> = key<SurfaceRegistry>('surfaces');

/**
 * The surfaces a caller has already loaded, ready for the assembly to adopt.
 * `loaded` (not module specs) because the caller has to import the modules
 * anyway to answer "which surface claims this invocation" — that is a pure
 * predicate over argv needing no kernel. Passing the loaded objects means ONE
 * import and one identity, so `registry.current()` and a surface's plugin row
 * are the same object. `registry` is the same instance the resolver reads.
 */
export interface SurfaceRows {
  registry: SurfaceRegistry;
  loaded: readonly AgentSurface[];
}

/* ── lifecycle events ──────────────────────────────────────────────────── */

/**
 * Wrap the outgoing request (system prompt, tools, messages). **Waterfall**:
 * call `next()` to delegate and return your own rewritten request, or return
 * `undefined` to pass the delegated answer through unchanged.
 *
 * The tool set may be narrowed (PTC projection does it) or left alone, but
 * never widened: the tool array is part of the cached prefix and of what the
 * model is allowed to call, so a hook adding tools fails the request instead
 * of silently expanding the model's reach.
 */
export const beforeLlmCall: EventKey<[ChatRequest], ChatRequest | undefined> = event('llm/before');

/**
 * Decide one tool call. **Serial, first decisive verdict wins**: the approval
 * gate answers first (highest priority), then each hook may return
 * `{action:'deny'}` or `{action:'rewrite', args}`. Returning `undefined` passes.
 *
 * A `rewrite` ends the chain: the rewritten call is not re-approved, which is
 * why rewriting is operator-level trust (the hook runs as the operator, not as
 * the model).
 */
export const beforeToolCall: EventKey<[ToolCall], ToolCallVerdict | undefined> = event('tool/before');

/**
 * Transform a tool result on its way into the log. **Waterfall**: `next()` runs
 * the rest of the chain and returns the transformed result, which the wrapper
 * may then adjust further.
 */
export const afterToolResult: EventKey<[ToolCall, string], string | undefined> = event('tool/after');

/** A plugin finished loading (or reloading). Observation only. */
export const pluginLoaded: EventKey<[string], void> = event('plugin/loaded');