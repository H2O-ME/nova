import { runAgent } from '../agent.js';
import { newId } from '../ids.js';
import type { AgentHooks, ChatProvider, ToolCall, ToolDefinition, UsageStats } from '../types.js';

/**
 * The `subagent` tool (dsh subagent design, single-provider simplification):
 * a focused nested agent loop with its OWN message surface. Context isolation
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

/** One nested-loop lifecycle moment, forwarded best-effort to `onProgress`. */
export type SubagentProgress =
  | { type: 'start'; label: string }
  | { type: 'tool_call'; label: string; call: ToolCall }
  | { type: 'usage'; label: string; stats: UsageStats }
  | { type: 'done'; label: string; usage: SubagentUsage; status: 'completed' | 'aborted' | 'ended' };

/** Child-side consumption: OWN loop only, never merged into the parent. */
export interface SubagentUsage {
  /** Wall time of the nested run in milliseconds. */
  elapsedMs: number;
  /** Nested provider request rounds (runAgent turns). */
  turns: number;
  /** Nested tool calls dispatched. */
  toolCalls: number;
  /** Prompt tokens the nested loop consumed. */
  promptTokens: number;
  /** Completion tokens the nested loop consumed. */
  completionTokens: number;
}

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
  /**
   * Best-effort visibility feed: the caller (TUI/REPL runner) renders these
   * as live subagent rows. Core owns the SCHEMA; tools must never depend on
   * it existing. Not called for the background mode's start — the job id
   * line covers that.
   */
  onProgress?: (progress: SubagentProgress) => void;
}

/**
 * Scout posture appended to the nested run's system prompt: the subagent is
 * a read-only recon unit by default — the parent owns design and edits, and
 * the report (not intermediate churn) is the deliverable. Mirrors the
 * codex-style orchestration lesson: subagents do simple, well-scoped work;
 * never design or open-ended implementation.
 */
export const SUBAGENT_POSTURE = `
## Subagent posture (scout)
You are an isolated scout subagent; your final report is the ONLY part of this conversation the parent will see, and it delegates to you to keep its own context small.
- Default to READ-ONLY reconnaissance: locate code, trace call chains, extract facts, run read-only verification commands. Do NOT design, refactor or implement changes, and do not expand scope — the parent owns design, decisions and all writes.
- Search narrowly and stop when the evidence is sufficient; never re-search what the brief already answers. Reading a few targeted files beats mapping the whole repository.
- Report format: the FIRST line is exactly one of "complete", "partial" or "blocked". Then give conclusions, evidence as path:line pointers (or command + key output lines, trimmed), and limitations. No file dumps, no filler.`;

const SUBAGENT_TOOL_NAME = 'subagent';
/** Bytes kept in the background job's live-progress ring. */
const TAIL_BYTES = 8 * 1024;

/** One-line arg summary for progress rows (never the full payload). */
function summarizeCallArgs(call: ToolCall): string {
  try {
    const raw = call.rawArgs.length > 0 ? call.rawArgs : JSON.stringify(call.args ?? {});
    return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  } catch {
    return '';
  }
}

/** Machine-readable usage trailer appended to the foreground report. */
export function subagentUsageTrailer(label: string, usage: SubagentUsage): string {
  return `[subagent: ${label} · ${usage.turns} turns · ${usage.toolCalls} tools · ${usage.promptTokens}+${usage.completionTokens} tok · ${(usage.elapsedMs / 1000).toFixed(1)}s]`;
}

async function runOnce(
  opts: SubagentToolOptions,
  label: string,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<{ report: string; usage: SubagentUsage; completed: boolean }> {
  // Same tools minus the subagent itself (no recursion) — evaluated live
  // so a host rebuild between registration and dispatch is honored.
  const nestedTools = opts.tools().filter((tool) => tool.name !== SUBAGENT_TOOL_NAME);

  const messages = [
    {
      id: newId('msg'),
      ts: Date.now(),
      role: 'user' as const,
      content: `[subagent task: ${label}]\n\n${prompt}\n\n[You are an isolated scout subagent. Work the task read-only unless the brief explicitly authorizes otherwise; when done, reply with your final report (first line: complete/partial/blocked) — it is the only part of this conversation the parent agent will see.]`,
    },
  ];

  const startedAt = Date.now();
  const fire = (progress: SubagentProgress): void => {
    try {
      opts.onProgress?.(progress);
    } catch {
      // Visibility must never break the run.
    }
  };
  fire({ type: 'start', label });

  let report: string | undefined;
  let toolCalls = 0;
  let lastStats: UsageStats | undefined;
  let finalStats: UsageStats | undefined;
  let stopReason: 'complete' | 'max_turns' | 'aborted' | undefined;
  for await (const event of runAgent({
    provider: opts.provider,
    messages,
    rootDir: opts.rootDir(),
    systemPrompt: opts.systemPrompt !== undefined ? `${opts.systemPrompt}\n${SUBAGENT_POSTURE}` : SUBAGENT_POSTURE,
    tools: nestedTools,
    ...(opts.hooks !== undefined ? { hooks: opts.hooks() } : {}),
    signal,
    maxTurns: opts.maxTurns,
  })) {
    if (event.type === 'message' && event.message.role === 'assistant' && event.message.content.trim().length > 0) {
      report = event.message.content.trim();
    } else if (event.type === 'tool_call_start') {
      toolCalls += 1;
      fire({ type: 'tool_call', label, call: event.call });
    } else if (event.type === 'usage') {
      lastStats = event.stats;
      fire({ type: 'usage', label, stats: event.stats });
    } else if (event.type === 'done') {
      stopReason = event.stopReason;
      // runAgent emits per-request `usage` but no terminal rollup: capture
      // the last snapshot here (doneStats stays undefined on a zero-request
      // run, e.g. immediate abort — the `??` zero-fill below covers that).
      finalStats = lastStats;
    }
  }
  const usage: SubagentUsage = {
    elapsedMs: Date.now() - startedAt,
    turns: finalStats?.turns ?? 0,
    toolCalls,
    promptTokens: finalStats?.promptTokens ?? 0,
    completionTokens: finalStats?.completionTokens ?? 0,
  };
  const completed = report !== undefined && stopReason !== 'aborted';
  fire({ type: 'done', label, usage, status: stopReason === 'aborted' ? 'aborted' : completed ? 'completed' : 'ended' });
  if (report !== undefined) return { report, usage, completed };
  const reason = stopReason ?? (signal?.aborted ? 'aborted' : 'no output');
  return {
    report: `[subagent: ${label}] ended without a report (stop: ${reason}). Partial work is not visible to the parent — re-run with a narrower prompt.`,
    usage,
    completed: false,
  };
}

export function createSubagentTool(opts: SubagentToolOptions): ToolDefinition {
  return {
    name: SUBAGENT_TOOL_NAME,
    description:
      'Delegate a focused sub-task to an isolated scout subagent: it starts from a FRESH context (it cannot see this ' +
      'conversation — the prompt must be a complete, self-contained brief: goal, relevant paths, constraints, expected ' +
      'output) and returns ONE final report. The point is context isolation: broad exploration fans out there instead ' +
      'of flooding this conversation.\n' +
      'USE for reconnaissance: multi-area scans, call-chain traces, exhaustive searches over unknown code, parallel ' +
      'fact extraction. Prefer 1-2 subagents with non-overlapping briefs; ask for candidate files with path:line ' +
      'evidence, not file dumps.\n' +
      'Do NOT use for design or complex implementation — the subagent works at plain instruction-following level ' +
      'without this conversation; the parent owns design, decisions and all edits, verifies key evidence, then acts. ' +
      'Simple lookups (one known file, one targeted search) also do not need a subagent.\n' +
      'Args: prompt (required, the full brief), label (optional short task name), run_in_background (optional boolean; ' +
      'returns a subagent-N job handle instead of waiting — read with the jobs tool, completion is announced automatically).',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The complete, self-contained brief for the subagent.' },
        label: { type: 'string', description: 'Short task name shown in progress displays.' },
        run_in_background: {
          type: 'boolean',
          description: 'Start detached and return a subagent-N job id immediately; read progress with the jobs tool.',
        },
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

      if (args['run_in_background'] === true) {
        if (ctx.jobs === undefined) return 'Error: background jobs are not available in this context';
        const controller = new AbortController();
        // Bounded live-progress ring (read via jobs output while running).
        const tail: string[] = [];
        const pushTail = (line: string): void => {
          tail.push(line);
          while (tail.join('\n').length > TAIL_BYTES) tail.shift();
        };
        const outcome = runOnce(
          {
            ...opts,
            onProgress: (progress) => {
              if (progress.type === 'tool_call') {
                pushTail(`› ${progress.call.name} ${summarizeCallArgs(progress.call)}`);
              }
            },
          },
          label,
          prompt,
          controller.signal,
        ).then(({ report, usage, completed }) => ({
          status: (completed ? 'completed' : report.includes('aborted') ? 'killed' : 'failed') as
            | 'completed'
            | 'killed'
            | 'failed',
          detail: subagentUsageTrailer(label, usage),
          report,
        }));
        // The registry only keeps an outcome {status, detail}; the report
        // itself stays readable via jobs output (read-after-notify contract).
        let finalReport: string | undefined;
        const done = outcome.then((o) => {
          finalReport = `${o.report}\n${o.detail}`;
          return { status: o.status, detail: o.detail };
        });
        const snapshot = ctx.jobs.start({
          kind: 'subagent',
          label: `[subagent: ${label}] ${prompt.slice(0, 80)}`,
          cancel: (reason) => controller.abort(reason),
          done,
          readOutput: () => {
            // Live progress tail (capped) before settlement; the full
            // report+usage trailer once settled. The ring prevents an
            // unbounded chatter log from pinning session memory.
            const out = finalReport ?? tail.join('\n');
            tail.length = 0;
            return out;
          },
        });
        void done.catch(() => undefined);
        return `Started background subagent ${snapshot.id}: ${label}\nYou will be notified automatically when it finishes — do not poll. When notified, read its report once with the jobs tool (action=output, id=${snapshot.id}); use action=stop to terminate it early.`;
      }

      const { report, usage } = await runOnce(opts, label, prompt, ctx.signal);
      return `${report}\n${subagentUsageTrailer(label, usage)}`;
    },
  };
}

/** Result-prefix helper kept next to the tool so tests and UIs agree on it. */
export function subagentReportPrefix(label: string): string {
  return `[subagent: ${label}]`;
}
