/**
 * The tool and command registries, as container services.
 *
 * This is what a plugin registers *into*, and what the loop, the surfaces and
 * the approval gate read *from* — so it is the busiest seam in the system. It
 * owns only the registry semantics (uniqueness, ownership, live views); what a
 * tool *does* stays in the plugin that registered it.
 *
 * Ownership is read from the registering plugin's own fiber — the `Context` a
 * plugin body receives carries that fiber, so `ctx.fiber.name` IS the plugin's
 * name. It used to be threaded in by a loading adapter, which meant a plugin
 * loaded by any other route registered its tools under `'assembly'`.
 */
import type { Context, Plugin, ToolDefinition, ToolPermissionKind } from '@nova-agent/core';
import {
  commands as commandsKey,
  tools as toolsKey,
  type CommandDefinition,
  type CommandEntry,
  type CommandRegistry,
  type ToolEntry,
  type ToolRegistry,
} from '@nova-agent/core';

export const toolboxPlugin: Plugin = {
  name: 'toolbox',
  apply: (ctx: Context): void => {
    const entries: ToolEntry[] = [];
    let snapshot: ToolDefinition[] | undefined;

    const registry: ToolRegistry = {
      all: () => {
        // Stable reference while the registry is unchanged: the loop asks every
        // turn, and the ai client keys its wire cache on array identity.
        snapshot ??= entries.map((entry) => entry.tool);
        return snapshot;
      },
      entries: () => entries,
      find: (name) => entries.find((entry) => entry.tool.name === name)?.tool,
      permissionFor: async (name, args) => {
        const entry = entries.find((item) => item.tool.name === name);
        if (entry === undefined) return undefined;
        if (args === undefined || entry.tool.permissionFor === undefined) return entry.permission;
        try {
          return await entry.tool.permissionFor(args);
        } catch {
          // Fail closed: a broken classifier must not fall back to the static
          // kind (often `read`), which would auto-allow under read-only.
          return 'execute';
        }
      },
      register: (tool, options) => {
        const owner = options?.owner ?? 'assembly';
        if (entries.some((entry) => entry.tool.name === tool.name)) {
          throw new Error(`duplicate tool name "${tool.name}" (plugin "${owner}")`);
        }
        const entry: ToolEntry = { plugin: owner, tool, permission: options?.permission ?? 'read' };
        entries.push(entry);
        snapshot = undefined;
        return () => {
          const index = entries.indexOf(entry);
          if (index >= 0) entries.splice(index, 1);
          snapshot = undefined;
        };
      },
    };

    const commands: CommandEntry[] = [];
    const commandRegistry: CommandRegistry = {
      all: () => commands.map((entry) => entry.command),
      entries: () => commands,
      register: (command) => {
        if (commands.some((entry) => entry.command.name === command.name)) {
          throw new Error(`duplicate command "/${command.name}"`);
        }
        const entry: CommandEntry = { plugin: ctx.fiber?.name ?? 'assembly', command };
        commands.push(entry);
        return () => {
          const index = commands.indexOf(entry);
          if (index >= 0) commands.splice(index, 1);
        };
      },
    };

    ctx.provide(toolsKey, registry);
    ctx.provide(commandsKey, commandRegistry);
  },
};

/**
 * Register one tool under the calling plugin's own name, with its undo tied to
 * that plugin's fiber.
 *
 * This is the ONE registration idiom for first-party tools — the same two lines
 * (`ctx.effect` + `registry.register`) every plugin would otherwise retype, and
 * therefore the same two lines that used to drift (some plugins passed `owner`,
 * some did not, and the loading adapter had to paper over it). A plugin that
 * registers a tool should also list `tools` in its `inject`, which is what makes
 * a replaced registry re-point it rather than strand it.
 * @param ctx - the registering plugin's context.
 * @param tool - the tool definition the model will see.
 * @param permission - highest-impact kind this tool needs; drives the approval gate.
 */
export function registerTool(ctx: Context, tool: ToolDefinition, permission: ToolPermissionKind): void {
  const registry = ctx.must(toolsKey);
  const owner = ctx.fiber?.name ?? 'assembly';
  ctx.effect(() => registry.register(tool, { permission, owner }), `tool(${tool.name})`);
}

/** Register one slash command, owned by the calling plugin's fiber. */
export function registerCommand(ctx: Context, command: CommandDefinition): void {
  const registry = ctx.must(commandsKey);
  ctx.effect(() => registry.register(command), `command(/${command.name})`);
}
