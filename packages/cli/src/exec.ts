import {
  newId,
  runAgent,
  type AgentEvent,
  type AgentMessage,
  type ChatProvider,
  type UserMessage,
} from '@nova-agent/core';
import { PermissionService, type ApprovalMode } from '@nova-agent/plugins';
import { wrapAutoCompact } from './auto-compact.js';
import { compactSession } from './compact.js';
import type { Config } from './config.js';
import { createNotifier } from './notify.js';
import { createSessionRuntime } from './session-runtime.js';
import { palette, plainPalette, statusLine, toolDoneLine, toolStartLine } from './ui.js';
import { agentRunBase, LONG_TASK, persistMissingToolResults, ToolTiming } from './runner-shared.js';

export interface ExecOptions {
  rootDir: string;
  config: Config;
  /** The task to execute in one non-interactive run. */
  prompt: string;
  /** Emit every AgentEvent as JSONL instead of human-readable text. */
  json: boolean;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
  /** Injectable for tests; defaults to OpenAICompatClient from config. */
  provider?: ChatProvider;
  /** Injectable raw output sink for tests; defaults to process.stdout.write. */
  out?: (text: string) => void;
}

/**
 * Non-interactive single run (codex exec mode): shares the plugin host,
 * context fragment, session persistence and approval gate with the
 * interactive modes, but cannot ask — approval requests are auto-denied,
 * so `read-only` (the default) only lets read tools run.
 */
export async function runExec(opts: ExecOptions): Promise<void> {
  const { rootDir, config, prompt, json } = opts;
  const write = opts.out ?? ((text: string) => process.stdout.write(text));
  const paint = opts.out === undefined && process.stdout.isTTY === true ? palette : plainPalette;

  const rt = await createSessionRuntime({
    rootDir,
    config,
    resumeFile: opts.resumeFile,
    approvalOverride: opts.approvalOverride,
  });
  const { session, messages, host, jobs, stats, systemPrompt } = rt;
  // Test-injected provider takes precedence over the config-built client.
  const provider: ChatProvider = opts.provider ?? rt.client;

  const userMsg: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: prompt };
  messages.push(userMsg);
  await session.append(userMsg);

  // Non-interactive: nobody can answer an approval prompt, so requests are denied.
  // (No audit trail: exec never asks, so no ask-path decisions exist to log.)
  const permission = new PermissionService(rt.approvalMode, async () => 'deny');
  // Headless runs cannot ask: 'never' denies every gated call deterministically,
  // inside the service, without dispatching any asker.
  permission.setPolicy('never');
  const hooks = host.agentHooks(permission);
  // Auto-compact BEYOND user-message boundaries: exec runs ONE runAgent over
  // the whole task, so the interactive runners' boundary checks can never
  // fire here. The beforeLLMCall hook is the per-turn interception point —
  // the only place a multi-turn headless task can shed context mid-run.
  wrapAutoCompact(hooks, {
    enabled: config.autoCompactTokenLimit !== undefined,
    limit: config.autoCompactTokenLimit ?? 0,
    compact: async (msgs: AgentMessage[]) => {
      const outcome = await compactSession({ client: provider, session, messages: msgs, trigger: 'auto' });
      // Apply the new surface IN PLACE: runAgent and the outer `messages`
      // reference the same array object, so a splice keeps every consumer
      // in sync without plumbed return values.
      msgs.splice(0, msgs.length, ...outcome.surface);
      if (json) write(`${JSON.stringify({ type: 'notice', text: '已自动压缩上下文（超过阈值；会话日志保留完整历史）' })}\n`);
      else write(`${paint.dim('⟳ 已自动压缩上下文（超过阈值；会话日志保留完整历史）')}\n`);
    },
    onError: (err: unknown) => {
      const text = `自动压缩失败（继续运行）：${err instanceof Error ? err.message : String(err)}`;
      if (json) write(`${JSON.stringify({ type: 'notice', text })}\n`);
      else write(`${paint.dim(`⟳ ${text}`)}\n`);
    },
    onWarn: (text: string) => {
      if (json) write(`${JSON.stringify({ type: 'notice', text })}\n`);
      else write(`${paint.dim(`⟳ ${text}`)}\n`);
    },
  });

  if (!json) write(`${paint.cyan('›')} ${prompt}\n`);
  const toolTiming = new ToolTiming();
  // Headless runs are exactly the ones the user walks away from; completion
  // and failure notifications matter most here (30s threshold: short runs
  // finish before the user can even switch windows). Disabled for injected
  // test sinks.
  const notify = createNotifier({ enabled: opts.out === undefined && config.notify !== false });
  const execStartedAt = Date.now();
  // SIGINT unwinds the run gracefully instead of hard-killing the process:
  // the finally below still disposes background jobs (no orphaned shells)
  // and --json consumers get a machine-readable run_error line.
  const interrupt = new AbortController();
  const onSigint = (): void => interrupt.abort();
  process.on('SIGINT', onSigint);
  const agentRun = agentRunBase({
    client: provider,
    session: () => session,
    rootDir: () => rootDir,
    messages: () => messages,
    tools: () => host.tools,
    hooks: () => hooks,
    jobs,
    systemPrompt,
    maxTurns: config.maxTurns,
  });
  try {
    for await (const event of runAgent({ ...agentRun(), signal: interrupt.signal })) {
      if (json) write(`${JSON.stringify(event)}\n`);
      else renderHuman(event, write, paint);
      switch (event.type) {
        case 'message':
          await session.append(event.message);
          break;
        case 'tool_call_result':
          await session.append(event.result);
          break;
        case 'turn_aborted':
          await session.append(event.message);
          break;
        case 'usage':
          Object.assign(stats, event.stats);
          break;
      }
    }
    const elapsed = Date.now() - execStartedAt;
    if (elapsed >= LONG_TASK.execDoneMs) {
      notify('任务已完成', `exec 运行约 ${Math.max(1, Math.round(elapsed / 60000))} 分钟，回到终端查看结果`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) write(`${JSON.stringify({ type: 'run_error', message })}\n`);
    else console.error(`出错：${message}`);
    if (Date.now() - execStartedAt >= LONG_TASK.execDoneMs) notify('任务出错', message.slice(0, 120));
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', onSigint);
    // Repair the log if the run died with assistant tool_calls unanswered.
    await persistMissingToolResults(session, messages).catch(() => undefined);
    // Kill background jobs before the process exits, or the spawned shells
    // outlive the session (dsh jobs dispose contract).
    await jobs.dispose().catch(() => undefined);
  }

  function renderHuman(
    event: AgentEvent,
    sink: (text: string) => void,
    p: typeof palette | typeof plainPalette,
  ): void {
    switch (event.type) {
      case 'text_delta':
        sink(event.text);
        break;
      case 'llm_retry':
        sink(`\n${p.dim(`⟳ 上游流中断（${event.error}），自动重试 ${event.attempt}/${event.maxRetries}…`)}\n`);
        break;
      case 'message':
        if (event.message.content.length > 0) sink('\n');
        break;
      case 'tool_call_start':
        toolTiming.start(event.call.id);
        sink(`${toolStartLine(p, event.call.name, event.call.rawArgs)}\n`);
        break;
      case 'tool_call_result': {
        const duration = toolTiming.finish(event.call.id);
        sink(`${toolDoneLine(p, event.call.name, event.call.rawArgs, event.result.content, duration).join('\n')}\n`);
        break;
      }
      case 'done': {
        const kind = event.stopReason === 'complete' ? 'complete' : event.stopReason;
        sink(`\n${statusLine(p, kind, stats, Date.now() - execStartedAt)}\n`);
        break;
      }
      default:
        break;
    }
  }
}

