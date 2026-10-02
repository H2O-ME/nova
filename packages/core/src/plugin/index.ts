/**
 * The plugin framework: services, fibers, effects and typed events.
 *
 * Everything in NovaAgent — the model client, the tool registry, the session
 * log, compaction, jobs, approvals, the surfaces themselves — is a plugin
 * loaded onto a `Context`. There is no privileged core to patch: a plugin that
 * replaces `llm` or `sessions` changes the product, and a plugin that reads
 * them is reloaded when its provider is swapped.
 *
 * ```ts
 * const root = Context.createRoot();
 * await root.plugin(llmPlugin, { baseURL, model });
 * await root.plugin(fsToolPlugin);
 * const missing = root.unsatisfied();   // boot check: declared-but-absent
 * ```
 */
export { Context } from './context.js';
export { registerCommand, registerTool } from './registration.js';
export { Fiber, type FiberState, type Runtime } from './fiber.js';
export { EventRegistry, event, isBailed, type EventKey, type Listener, type Next, type OnOptions } from './events.js';
export { ServiceStore, ServiceUnavailable, type ServiceImpl } from './store.js';
export {
  key,
  pluginName,
  resolvePlugin,
  type AnyPlugin,
  type AnyServiceKey,
  type Awaitable,
  type ConfigSchema,
  type Dispose,
  type Plugin,
  type PluginBase,
  type PluginConstructor,
  type PluginFunction,
  type PluginObject,
  type ResolvedPlugin,
  type ServiceKey,
  type ServiceOf,
} from './types.js';
export {
  afterToolResult,
  approval,
  beforeLlmCall,
  beforeToolCall,
  beforeTurnEnd,
  commands,
  compaction,
  contextInsights,
  jobs,
  llm,
  routes,
  sessions,
  skills,
  spill,
  surfaces,
  tools,
  userQuestions,
  type ApprovalService,
  type CommandDefinition,
  type CommandEntry,
  type CommandRegistry,
  type CommandRunContext,
  type CompactionService,
  type LlmService,
  type PluginRoute,
  type PluginRouteHandler,
  type RouteRegistry,
  type SessionService,
  type SkillInfo,
  type SkillRegistry,
  type SpillService,
  type SurfaceRegistry,
  type SurfaceRows,
  type ToolEntry,
  type ToolRegistry,
  type UserQuestionsService,
} from './capabilities.js';
