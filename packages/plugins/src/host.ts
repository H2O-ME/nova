/**
 * `PluginHost` — the legacy plugin vocabulary, implemented on the container.
 *
 * Historically this class *was* the container: it owned the registries, the
 * hook map and the composition. Now the container does (`Context` / fibers /
 * effects / typed events) and this file is the compatibility facade, so the
 * public plugin API — `PluginContext`, `registerTool`, `registerCommand`,
 * `registerHook` — keeps working verbatim while every registration a plugin
 * makes becomes a container effect. That last part is what makes teardown
 * correct by construction instead of by discipline.
 *
 * One behavioural note, and it is deliberate: legacy hooks are wrapped into the
 * new chains in *reverse registration order*, because a waterfall applies the
 * outermost listener last. That reproduces the historical "each hook sees what
 * the previous one produced" composition exactly, while new-style plugins use
 * `next()` directly.
 */
import {
  afterToolResult as afterToolResultEvent,
  beforeLlmCall as beforeLlmCallEvent,
  beforeToolCall as beforeToolCallEvent,
  commands as commandsKey,
  tools as toolsKey,
  Context,
  type AgentHooks,
  type CommandEntry,
  type Fiber,
  type Plugin as CorePlugin,
  type ToolDefinition,
  type ToolEntry,
  type ToolPermissionKind,
} from '@nova-agent/core';
import { composeHooks } from './hooks.js';
import { toolboxPlugin } from './toolbox.js';
import type { HookEvent, HookMap, Plugin, PluginContext, ToolOptions } from './types.js';

/** Legacy hook name → the container event that replaces it. */
const HOOK_EVENTS = {
  beforeLLMCall: beforeLlmCallEvent,
  beforeToolCall: beforeToolCallEvent,
  afterToolResult: afterToolResultEvent,
} as const;

export class PluginHost {
  /** The container this host speaks for — the kernel shares this root. */
  readonly context: Context;
  private readonly pending: Plugin[] = [];
  private readonly fibers = new Set<Fiber>();

  constructor(
    readonly rootDir: string,
    context?: Context,
  ) {
    this.context = context ?? Context.createRoot();
    // The registry every plugin registers into — one per host, unloaded with
    // the host, so the next host on the same container can provide it again.
    const toolbox = this.context.plugin(toolboxPlugin, {}, 'toolbox');
    this.fibers.add(toolbox);
    if (toolbox.state === 'failed') throw toolbox.error;
  }

  /** Queue a plugin; nothing runs until `activate()`. */
  use(plugin: Plugin): this {
    this.pending.push(plugin);
    return this;
  }

  /**
   * Load every queued plugin, each as its own fiber. A plugin that throws
   * rejects here with its own error and leaves nothing behind — the fiber
   * unwinds whatever it had registered before the failure.
   */
  async activate(): Promise<void> {
    for (const plugin of this.pending.splice(0)) {
      const fiber = this.context.plugin(adapter(plugin, this.rootDir));
      this.fibers.add(fiber);
      await fiber.ready;
    }
  }

  /** Unload every plugin this host loaded, newest first. */
  async dispose(): Promise<void> {
    this.pending.length = 0;
    for (const fiber of [...this.fibers].reverse()) await fiber.dispose();
    this.fibers.clear();
  }

  /**
   * Unload the plugins but keep the registry. A workspace switch or a PTC-mode
   * change re-rosters the same registry: the tool service stays provided (so
   * consumers and the approval gate never see it vanish and reappear) while
   * every tool the old roster registered is really gone.
   */
  async reset(): Promise<void> {
    const all = [...this.fibers];
    // The toolbox was loaded first, and it is the one nothing re-creates.
    const [toolbox] = all;
    for (const fiber of all.reverse()) {
      if (fiber !== toolbox) await fiber.dispose();
    }
    this.pending.length = 0;
    this.fibers.clear();
    if (toolbox !== undefined) this.fibers.add(toolbox);
  }

  get tools(): ToolDefinition[] {
    // Deliberately the stable snapshot: the loop asks every turn and the ai
    // client keys its wire cache on array identity.
    return this.context.must(toolsKey).all() as ToolDefinition[];
  }

  get toolEntries(): readonly ToolEntry[] {
    return this.context.must(toolsKey).entries();
  }

  get commandEntries(): readonly CommandEntry[] {
    return this.context.must(commandsKey).entries();
  }

  permissionFor(toolName: string, args?: Record<string, unknown>): Promise<ToolPermissionKind | undefined> {
    return this.context.must(toolsKey).permissionFor(toolName, args);
  }

  /**
   * Compose the live chains into the `AgentHooks` the loop consumes. The
   * approval gate is not passed in any more: it is a plugin
   * (`permissionGatePlugin`) loaded by the roster, so it reloads with its
   * providers instead of being re-wired by hand on every assembly.
   */
  agentHooks(): AgentHooks {
    return composeHooks(this.context);
  }

  /** What is actually loaded — name, state, declared dependencies. */
  roster(): ReturnType<Context['roster']> {
    return this.context.roster();
  }
}

/** A legacy plugin as a container plugin: one fiber, effects, real teardown. */
function adapter(plugin: Plugin, rootDir: string): CorePlugin {
  const hooks: Record<HookEvent, Array<HookMap[HookEvent]>> = {
    beforeLLMCall: [],
    beforeToolCall: [],
    afterToolResult: [],
  };
  return {
    name: plugin.name,
    inject: [toolsKey],
    apply: (ctx) => {
      plugin.activate(legacyContext(ctx, plugin, rootDir, hooks));
    },
  };
}

/**
 * The legacy `PluginContext` over a container context. Hooks are registered as
 * ONE listener per event per plugin (not one per hook) so the historical
 * composition order inside a plugin is preserved verbatim.
 */
function legacyContext(
  ctx: Context,
  plugin: Plugin,
  rootDir: string,
  hooks: Record<HookEvent, Array<HookMap[HookEvent]>>,
): PluginContext {
  const registry = ctx.must(toolsKey);
  const install = (event: HookEvent): void => {
    ctx.on(
      HOOK_EVENTS[event] as never,
      (async (...raw: unknown[]): Promise<unknown> => {
        const next = raw[raw.length - 1] as (() => Promise<unknown>) | undefined;
        // Delegate first, then apply this plugin's hooks in their own order:
        // the chain's final answer is this plugin's, and what it consumed was
        // everything downstream.
        const args = typeof next === 'function' ? raw.slice(0, -1) : raw;
        let carried = typeof next === 'function' ? await next() : undefined;
        for (const fn of hooks[event]) {
          carried = await (fn as unknown as (...a: unknown[]) => Promise<unknown>)(...args, carried);
        }
        return carried;
      }) as never,
      // Reverse registration order: a waterfall applies the outermost last.
      { prepend: true },
    );
  };
  return {
    pluginName: plugin.name,
    rootDir,
    registerTool: (def: ToolDefinition, opts?: ToolOptions) => {
      ctx.effect(() => registry.register(def, { ...opts, owner: plugin.name }), `tool(${def.name})`);
    },
    registerCommand: (def) => {
      ctx.effect(() => ctx.must(commandsKey).register(def), `command(/${def.name})`);
    },
    registerHook: <K extends HookEvent>(event: K, fn: HookMap[K]) => {
      hooks[event].push(fn as HookMap[HookEvent]);
      if (hooks[event].length === 1) install(event);
    },
    tools: () => registry.all() as ToolDefinition[],
  };
}