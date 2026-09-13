import { runAgent } from '../agent.js';
import { newId } from '../ids.js';
import type { AgentHooks, ChatProvider, ToolDefinition } from '../types.js';

/**
 * The `subagent` tool (dsh subagent design, single-provider simplification):
 * a fresh nested agent loop with its OWN message surface. Context isolation
 * is the point — the subagent cannot see this conversation, so the prompt
 * must be self-contained; its final report flows back as the tool result
 * (the parent logs it like any tool output, keeping "model-visible means
 * logged" at the parent boundary; the subagent's own conversation is
 * ephemeral and never persists).
 *
 * Recursion is impossible by construction: `subagent` is filtered out of the
 * subagent's own toolset (depth 1, dsh's maxDepth-0 equivalent for tools that
 * would re-enter the loop). The nested loop runs through the SAME hooks, so
 * every nested tool call passes the same approval gate and pipeline as the
 * parent's.
 */

export interface SubagentToolOptions {
  provider: ChatProvider;
  /** Live tool list of the parent (accessor — the host may rebuild). */
  tools: () => ToolDefinition[];
  /** Parent's hook chain: nested calls share the approval gate. */
  hooks?: () => AgentHooks | undefined;
  systemPrompt?: string;
  maxTurns?: number;
  /** Root the subagent's file/bash tools resolve against. */
  rootDir: () => string;
}

const SUBAGENT_TOOL_NAME = 'subagent';

export function createSubagentTool(opts: SubagentToolOptions): ToolDefinition {
  return {
    name: SUBAGENT_TOOL_NAME,
    description:
      'Run a focused sub-task in an isolated subagent: it gets a FRESH context (it cannot see this conversation — ' +
      'write the prompt as a complete, self-contained brief: goal, relevant file paths, constraints, expected output) ' +
      'and the same tools, then returns its final report. Use for parallelizable research, exhaustive searches or ' +
      'self-contained subtasks whose intermediate tool output would otherwise flood this conversation. ' +
      'Args: prompt (required, the full brief), label (optional short task name).',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The complete, self-contained brief for the subagent.' },
        label: { type: 'string', description: 'Short task name shown in progress displays.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    // A subagent turn legitimately runs minutes; the parent turn's abort is
    // the real ceiling (propagated through ctx.signal below).
    async execute(args, ctx) {
      const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : '';
      if (prompt.trim().length === 0) return 'Error: prompt must be a non-empty string';
      const label = typeof args['label'] === 'string' && args['label'].trim().length > 0 ? args['label'].trim() : 'subtask';

      // Same tools minus the subagent itself (no recursion) — evaluated live
      // so a host rebuild between registration and dispatch is honored.
      const nestedTools = opts.tools().filter((tool) => tool.name !== SUBAGENT_TOOL_NAME);

      const messages = [
        {
          id: newId('msg'),
          ts: Date.now(),
          role: 'user' as const,
          content: `[subagent task: ${label}]\n\n${prompt}\n\n[You are an isolated subagent. Work the task with the tools available; when done, reply with your final report — it is the only part of this conversation the parent agent will see.]`,
        },
      ];

      let report: string | undefined;
      let stopReason: string | undefined;
      for await (const event of runAgent({
        provider: opts.provider,
        messages,
        rootDir: opts.rootDir(),
        ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
        tools: nestedTools,
        ...(opts.hooks !== undefined ? { hooks: opts.hooks() } : {}),
        signal: ctx.signal,
      })) {
        if (event.type === 'message' && event.message.role === 'assistant' && event.message.content.trim().length > 0) {
          report = event.message.content.trim();
        } else if (event.type === 'done') {
          stopReason = event.stopReason;
        }
      }

      if (report !== undefined) return `[subagent: ${label}] ${report}`;
      const reason = stopReason ?? (ctx.signal?.aborted ? 'aborted' : 'no output');
      return `[subagent: ${label}] ended without a report (stop: ${reason}). Partial work is not visible to the parent — re-run with a narrower prompt.`;
    },
  };
}

/** Result-prefix helper kept next to the tool so tests and UIs agree on it. */
export function subagentReportPrefix(label: string): string {
  return `[subagent: ${label}]`;
}
