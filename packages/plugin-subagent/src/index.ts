import { createSubagentTool, tools as toolsKey, type SubagentProgress } from '@nova-agent/core';
import type { AgentHooks, ChatProvider, Plugin, ToolDefinition } from '@nova-agent/core';
import { registerTool } from '@nova-agent/core';

/** Registers `subagent` (implementation in core): opt-in, and the nested loop reuses the parent's hooks. */
export interface SubagentPluginOptions {
  provider: ChatProvider;
  /** Live parent tool list (accessor — the subagent tool itself is filtered out). */
  tools: () => ToolDefinition[];
  /** Parent hook chain (approval gate + hooks); re-read at dispatch time. */
  hooks?: () => AgentHooks | undefined;
  systemPrompt?: string;
  maxTurns?: number;
  rootDir: () => string;
  /** Visibility feed: forwarded to the core tool (renders live subagent rows). */
  onProgress?: (progress: SubagentProgress) => void;
}

export function subagentPlugin(options: SubagentPluginOptions): Plugin {
  return {
    name: 'subagent',
    description: 'Isolated subagent runs for self-contained subtasks.',
    inject: [toolsKey],
    apply: (ctx) => {
      const tool = createSubagentTool({
        provider: options.provider,
        tools: options.tools,
        ...(options.hooks !== undefined ? { hooks: options.hooks } : {}),
        ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
        ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
        rootDir: options.rootDir,
        ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      });
      // 'read', not 'execute': a delegation is not itself the side effect. Every
      // consequence is a nested tool call, and those pass this same gate one by
      // one (the nested loop reuses the parent's `hooks` chain). Gating the call
      // asked the wrong question — "run subagent?" instead of the concrete
      // `bash` inside it — and made the read-only recon fan-out, the tool's main
      // use, unstartable by default. The reference declares no permission on its
      // subagent tool either; it pins the CHILD policy to 'never' instead.
      registerTool(ctx, tool, 'read');
    },
  };
}
