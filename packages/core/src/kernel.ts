/**
 * The kernel handle layer (M11): `AgentSession` drives runs, logs and events;
 * `KernelEvent` is the ONE protocol every surface consumes; `AgentSurface` is
 * the contract a surface package implements. The assembly of a concrete
 * session (provider + plugin host + permission engine) lives in
 * the plugins package (`createAgentKernel`) — core stays provider- and
 * host-agnostic, the same way `runAgent` takes a `ChatProvider` interface.
 *
 * "Model-visible means logged" is enforced inside `AgentSession`: surfaces
 * never persist, never bookkeep, never guess phases.
 */
export * from './kernel/protocol.js';
export { EventPump } from './kernel/pump.js';
export { RunMeter, type RunStats } from './kernel/metrics.js';
export {
  AgentSession,
  persistMissingToolResults,
  type AgentSessionDeps,
  type AgentStatus,
  type UsageAnchorState,
} from './kernel/session.js';

/**
 * A pluggable surface: the TUI, the WebUI's launch mode, the bot channel and
 * the headless runners are all just implementations of this. The cli picks
 * one per invocation and hands it the assembled session; a third-party
 * surface package depends on nothing above `core`/`plugins` — the same
 * "everything is a plugin" posture tools/commands/hooks already have, now
 * extended to the human-facing end.
 */
export interface AgentSurface {
  readonly name: string;
  start(kernel: AgentSurfaceKernel): void | Promise<void>;
}

/**
 * What a surface receives: the assembled kernel (session handle plus the
 * product-agnostic knobs a surface drives). Deliberately structural — the
 * concrete bundle is the plugins package' `Kernel`, widened here so any
 * surface package can type against core only.
 */
export interface AgentSurfaceKernel {
  readonly agent: import('./kernel/session.js').AgentSession;
}
