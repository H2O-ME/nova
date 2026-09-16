import { errMessage,
  newId,
  runAgent,
  type AgentEvent,
  type AgentMessage,
  type ChatProvider,
  type UserMessage,
} from '@nova-agent/core';
import type { ApprovalMode } from '@nova-agent/plugins';
import { wrapHeadlessAutoCompact } from './auto-compact.js';
import { compactSession } from './compact.js';
import type { Config } from './config.js';
import { createNotifier } from './notify.js';
import { createSessionRuntime } from './session-runtime.js';
import { createHeadlessPermission } from './runner-shared.js';
import { createRunnerBookkeeping, createTurnNotifier, isUserInterrupt } from './runner-loop.js';
import { palette, plainPalette, statusLine, toolDoneLine, toolStartLine } from './ui.js';
import { agentRunBase, LONG_TASK, persistMissingToolResults, ToolTiming } from './runner-shared.js';

/**
 * `--json` 模式下 AgentEvent 之外的两类控制行（AGENTS.md §2 记载的 schema）。
 * additive 演进：只新增成员/字段，不改变既有成员的形状。
 */
export type ExecControlEvent =
  | { type: 'run_error'; message: string }
  | { type: 'notice'; text: string };

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
  const permission = createHeadlessPermission(rt.approvalMode);
  const hooks = host.agentHooks(permission);
  // Auto-compact BEYOND user-message boundaries: exec runs ONE runAgent over
  // the whole task, so the interactive runners' boundary checks can never
  // fire here. The beforeLLMCall hook is the per-turn interception point —
  // the only place a multi-turn headless task can shed context mid-run.
  // 接线单源在 wrapHeadlessAutoCompact（splice 原位契约 + 文案）。
  const emitControl = (event: ExecControlEvent): void => {
    if (json) write(`${JSON.stringify(event)}\n`);
    else if (event.type === 'notice') write(`${paint.dim(`⟳ ${event.text}`)}\n`);
  };
  wrapHeadlessAutoCompact(hooks, {
    limit: config.autoCompactTokenLimit,
    compact: (msgs: AgentMessage[]) =>
      compactSession({ client: provider, session, messages: msgs, trigger: 'auto' }),
    onCompacted: (text) => emitControl({ type: 'notice', text }),
    onError: (text) => emitControl({ type: 'notice', text }),
    onWarn: (text) => emitControl({ type: 'notice', text }),
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
  // 事件消费簿记单源（runner-loop）：无头 runner 不持锚点态，usage 只累计 stats。
  const bookkeeping = createRunnerBookkeeping({ session: () => session, stats });
  const turnNotifier = createTurnNotifier((title, body) => notify(title, body), {
    doneMs: LONG_TASK.execDoneMs,
  });
  try {
    for await (const event of runAgent({ ...agentRun(), signal: interrupt.signal })) {
      if (json) write(`${JSON.stringify(event)}\n`);
      else renderHuman(event, write, paint);
      await bookkeeping.apply(event);
    }
    turnNotifier.done(execStartedAt);
  } catch (err) {
    const message = errMessage(err);
    // 与 repl/tui 同一归类（runner-loop.isUserInterrupt）：以本轮 signal 是否
    // 真的触发为准——错误文案含 "aborted" 的网络超时不算用户中断，照常走
    // run_error；只有 SIGINT 真正解绕才归类为「已中断」（退出码 130，非失败）。
    if (isUserInterrupt(interrupt.signal)) {
      if (json) emitControl({ type: 'notice', text: '任务已中断（SIGINT）；会话日志保留到中断前' });
      else write(`${paint.yellow('已中断')}\n`);
      process.exitCode = 130;
      return;
    }
    if (json) emitControl({ type: 'run_error', message });
    else console.error(`出错：${message}`);
    turnNotifier.error(execStartedAt, message);
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

