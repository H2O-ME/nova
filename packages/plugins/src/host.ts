import type { AgentHooks, ToolCallVerdict, ToolDefinition } from '@nova-agent/core';
import { PermissionService } from './permission.js';
import type {
  CommandDefinition,
  HookEvent,
  HookMap,
  PermissionKind,
  Plugin,
  PluginContext,
  ToolOptions,
} from './types.js';

export interface ToolEntry {
  plugin: string;
  tool: ToolDefinition;
  permission: PermissionKind;
}

export interface CommandEntry {
  plugin: string;
  command: CommandDefinition;
}

/**
 * The plugin container: activation, registries, and hook composition.
 * Everything the agent can do (tools, commands, hooks) is registered through
 * PluginContext — built-in capabilities are just first-party plugins.
 */
export class PluginHost {
  private readonly plugins: Plugin[] = [];
  private readonly hooks = new Map<HookEvent, Array<HookMap[HookEvent]>>();
  private activatedCount = 0;
  readonly toolEntries: ToolEntry[] = [];
  readonly commandEntries: CommandEntry[] = [];

  constructor(readonly rootDir: string) {}

  use(plugin: Plugin): this {
    this.plugins.push(plugin);
    return this;
  }

  /**
   * Activates only plugins `use`d since the last call, so runners can attach
   * lazily-loaded plugins after the initial boot activation without
   * re-running the built-ins.
   */
  async activate(): Promise<void> {
    for (const plugin of this.plugins.slice(this.activatedCount)) {
      await plugin.activate(this.contextFor(plugin));
    }
    this.activatedCount = this.plugins.length;
  }

  private contextFor(plugin: Plugin): PluginContext {
    return {
      pluginName: plugin.name,
      rootDir: this.rootDir,
      registerTool: (def: ToolDefinition, opts?: ToolOptions) => {
        if (this.toolEntries.some((entry) => entry.tool.name === def.name)) {
          throw new Error(`duplicate tool name "${def.name}" (plugin "${plugin.name}")`);
        }
        this.toolEntries.push({ plugin: plugin.name, tool: def, permission: opts?.permission ?? 'read' });
      },
      registerCommand: (def: CommandDefinition) => {
        if (this.commandEntries.some((entry) => entry.command.name === def.name)) {
          throw new Error(`duplicate command "/${def.name}" (plugin "${plugin.name}")`);
        }
        this.commandEntries.push({ plugin: plugin.name, command: def });
      },
      registerHook: <K extends HookEvent>(event: K, fn: HookMap[K]) => {
        const list = this.hooks.get(event) ?? [];
        list.push(fn as HookMap[HookEvent]);
        this.hooks.set(event, list);
      },
      tools: () => this.tools,
    };
  }

  get tools(): ToolDefinition[] {
    return this.toolEntries.map((entry) => entry.tool);
  }

  /**
   * Effective permission kind for one call: the tool's `permissionFor(args)`
   * classifier wins when present (e.g. fs reads escalate out-of-workspace
   * paths to `read-external`), otherwise the static registered kind.
   * Classifiers may be async (sandbox-aware classification resolves real
   * paths before deciding).
   */
  async permissionFor(toolName: string, args?: Record<string, unknown>): Promise<PermissionKind | undefined> {
    const entry = this.toolEntries.find((item) => item.tool.name === toolName);
    if (entry === undefined) return undefined;
    if (args !== undefined && entry.tool.permissionFor !== undefined) {
      try {
        return await entry.tool.permissionFor(args);
      } catch {
        // Fail closed: a broken classifier must not fall back to the static
        // kind (often `read`), which would auto-allow under read-only. The
        // conservative `execute` always gates.
        return 'execute';
      }
    }
    return entry.permission;
  }

  /**
   * Compose all plugin hooks (plus the optional permission gate) into the
   * single AgentHooks implementation runAgent consumes.
   */
  agentHooks(permission?: PermissionService): AgentHooks {
    return {
      beforeLLMCall: async (req) => {
        for (const fn of this.hooks.get('beforeLLMCall') ?? []) {
          req = await (fn as HookMap['beforeLLMCall'])(req);
        }
        return req;
      },
      beforeToolCall: async (call) => {
        if (permission) {
          const kind = await this.permissionFor(call.name, call.args);
          if (kind) {
            const decision = await permission.decide(call.name, kind, call);
            if (decision === 'deny') return { action: 'deny', reason: 'by user' };
          }
        }
        let effective: ToolCallVerdict = { action: 'allow' };
        for (const fn of this.hooks.get('beforeToolCall') ?? []) {
          // Trust seam: a `rewrite` verdict replaces the call args AFTER the
          // permission gate — the rewritten call does not pass approval again.
          // Acceptable today because no built-in plugin rewrites; external
          // hooks that do own the consequence (they run as the operator).
          const verdict = await (fn as HookMap['beforeToolCall'])(call);
          if (verdict.action === 'deny') return verdict;
          if (verdict.action === 'rewrite') effective = verdict;
        }
        return effective;
      },
      afterToolResult: async (call, result) => {
        for (const fn of this.hooks.get('afterToolResult') ?? []) {
          result = await (fn as HookMap['afterToolResult'])(call, result);
        }
        return result;
      },
    };
  }
}
