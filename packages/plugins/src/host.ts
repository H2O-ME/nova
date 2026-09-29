/**
 * `PluginHost` — the kernel's plugin host, on top of the container.
 *
 * There is ONE plugin protocol: core's `Plugin` (`{ name, inject?, apply(ctx) }`),
 * the same shape the container loads and the same shape a third-party module
 * exports. Historically a second, Nova-specific vocabulary (`{ name,
 * activate(ctx) }` over a `PluginContext` with `registerTool` / `registerCommand`
 * / `registerHook`) lived here and this file adapted it onto the container. That
 * facade is gone: it was a second way to say the same thing, its hook
 * composition silently dropped every hook but the last one, and it kept
 * capability keys from being declared in `inject` (so a plugin could not be
 * reloaded when its provider was replaced).
 *
 * What remains is a thin, useful wrapper: it owns the shared root `Context`,
 * keeps the toolbox registry alive across re-rosters, and projects the
 * container's registries into the handful of read shapes the loop and the
 * surfaces consume.
 */
import {
  commands as commandsKey,
  tools as toolsKey,
  Context,
  type AgentHooks,
  type CommandEntry,
  type Fiber,
  type Plugin,
  type ToolDefinition,
  type ToolEntry,
  type ToolPermissionKind,
} from '@nova-agent/core';
import { composeHooks } from './hooks.js';
import { toolboxPlugin } from './toolbox.js';

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
      const fiber = this.context.plugin(plugin);
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
   * approval gate is not passed in: it is a plugin (`permissionGatePlugin`)
   * loaded by the roster, so it reloads with its providers instead of being
   * re-wired by hand on every assembly.
   */
  agentHooks(): AgentHooks {
    return composeHooks(this.context);
  }

  /** What is actually loaded — name, state, declared dependencies. */
  roster(): ReturnType<Context['roster']> {
    return this.context.roster();
  }
}
