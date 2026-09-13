import { createSubagentTool } from '@nova-agent/core';
import type { AgentHooks, ChatProvider, ToolDefinition } from '@nova-agent/core';
import type { Plugin } from '../types.js';

/**
 * Registers the `subagent` tool (implementation in core: createSubagentTool).
 * Opt-in like the PTC plugin: the runner supplies its provider + live tool
 * list; the nested loop reuses the parent's hook chain, so subagent tool
 * calls pass the same approval gate. Gated 'execute' like other capability
 * tools — a subagent run can invoke execute-class tools itself.
 */

export interface SubagentPluginOptions {
  provider: ChatProvider;
  /** Live parent tool list (accessor — the subagent tool itself is filtered out). */
  tools: () => ToolDefinition[];
  /** Parent hook chain (approval gate + hooks); re-read at dispatch time. */
  hooks?: () => AgentHooks | undefined;
  systemPrompt?: string;
  maxTurns?: number;
  rootDir: () => string;
}

export function subagentPlugin(options: SubagentPluginOptions): Plugin {
  return {
    name: 'subagent',
    description: 'Isolated subagent runs for self-contained subtasks.',
    activate(ctx) {
      const tool = createSubagentTool({
        provider: options.provider,
        tools: options.tools,
        ...(options.hooks !== undefined ? { hooks: options.hooks } : {}),
        ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
        ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
        rootDir: options.rootDir,
      });
      ctx.registerTool(tool, { permission: 'execute' });
    },
  };
}
