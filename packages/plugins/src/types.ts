import type { ChatRequest, ToolCall, ToolDefinition, ToolCallVerdict, ToolPermissionKind } from '@nova-agent/core';

export type PermissionKind = ToolPermissionKind;

export interface ToolOptions {
  /** Highest-impact permission this tool needs; drives the approval gate. */
  permission?: PermissionKind;
}

export interface CommandRunContext {
  rootDir: string;
  log(message: string): void;
}

export interface CommandDefinition {
  /** Slash name without the leading '/'. */
  name: string;
  description: string;
  run(args: string, ctx: CommandRunContext): void | Promise<void>;
}

/** Hook signatures a plugin may register, keyed by lifecycle event. */
export interface HookMap {
  /** Chain over the outgoing request; each hook may rewrite it. */
  beforeLLMCall: (req: ChatRequest) => Promise<ChatRequest>;
  /** Observe/override the permission verdict or rewrite tool args. */
  beforeToolCall: (call: ToolCall) => Promise<ToolCallVerdict>;
  /** Transform the raw tool result before it enters the message log. */
  afterToolResult: (call: ToolCall, result: string) => Promise<string>;
}

export type HookEvent = keyof HookMap;

export interface PluginContext {
  readonly pluginName: string;
  readonly rootDir: string;
  registerTool(def: ToolDefinition, opts?: ToolOptions): void;
  registerCommand(def: CommandDefinition): void;
  registerHook<K extends HookEvent>(event: K, fn: HookMap[K]): void;
  /**
   * Live view of every tool registered so far across all plugins. Read it
   * AT CALL TIME, not at activation time: later-activated plugins (skills)
   * add tools this view must include.
   */
  tools(): ToolDefinition[];
}

/**
 * A plugin is a plain activation function over its context — no manifest,
 * no sandbox (pi-style "extension as code"). Built-in capabilities use the
 * exact same API as third-party plugins.
 */
export interface Plugin {
  name: string;
  description?: string;
  activate(ctx: PluginContext): void | Promise<void>;
}
