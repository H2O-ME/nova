import { OpenAICompatClient } from '@nova-agent/ai';
import { createAgentKernel, type ApprovalMode } from '@nova-agent/plugins';
import {
  type AgentSession,
  type ChatProvider,
  type KernelEvent,
} from '@nova-agent/core';
import { createNotifier } from './notify.js';
import { createProvider, toKernelConfig } from './kernel-boot.js';
import {
  emptyCompletionNotice,
  plainPaint,
  resolvePaint,
  retryNotice,
  statusLine,
  toolDoneLines,
  toolStartLine,
  ToolTiming,
  type Paint,
} from './lines.js';
import type { Config } from './config.js';

/**
 * `--json` 模式下 KernelEvent 之外的两类控制行（AGENTS.md §2 记载的 schema）。
 * additive 演进：只新增成员/字段，不改变既有成员的形状。内核的 `run_failed`
 * 事件在 JSON 面翻译为 `run_error` 行（既有消费者的契约不变），人类面直接
 * 渲染；其余内核事件逐行透传（additive 超集）。
 */
export type ExecControlEvent =
  | { type: 'run_error'; message: string }
  | { type: 'notice'; text: string };

export interface ExecOptions {
  rootDir: string;
  config: Config;
  /** The task to execute in one non-interactive run. */
  prompt: string;
  /** Emit every kernel event as JSONL instead of human-readable text. */
  json: boolean;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
  /** Injectable for tests; defaults to OpenAICompatClient from config. */
  provider?: ChatProvider;
  /** Injectable raw output sink for tests; defaults to process.stdout.write. */
  out?: (text: string) => void;
}

/**
 * Non-interactive single run (codex exec mode): drives the SAME kernel handle
 * as the interactive surfaces — one assembly, "model-visible means logged"
 * enforced in-kernel, turn-failure repair owned by the run loop — but cannot
 * ask: `never` policy denies ungated requests deterministically, so
 * `read-only` (the default) only lets read tools run. Auto-compact gates
 * INSIDE every request (perRequestCompact): one run spans the whole task,
 * the boundary checks could never fire here.
 */
export async function runExec(opts: ExecOptions): Promise<void> {
  const { rootDir, config, prompt, json } = opts;
  const write = opts.out ?? ((text: string) => process.stdout.write(text));
  // 调色板装配单源 resolvePaint（与 repl 同路）：尊重 ui.theme 与
  // NO_COLOR/TERM=dumb；注入 sink（测试）恒无色。
  const paint: Paint = opts.out === undefined ? resolvePaint(config.ui?.theme ?? 'dark') : plainPaint;

  // Test-injected provider takes precedence; the config-built client gets the
  // cache-affinity session id rebound once the kernel has created its session.
  let ownedClient: OpenAICompatClient | undefined;
  const provider: ChatProvider = opts.provider ?? (ownedClient = createProvider(config));
  const kernel = await createAgentKernel({
    rootDir,
    provider,
    config: toKernelConfig(config, opts.approvalOverride),
    ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    perRequestCompact: true,
  });
  ownedClient?.setSessionId(kernel.agent.session.id);
  // Non-interactive: nobody can answer an approval prompt, so requests are
  // denied without dispatching an asker (fail-closed; no ask-path audit exists).
  kernel.permission.setPolicy('never');

  if (!json) write(`${paint.cyan('›')} ${prompt}\n`);
  const notify = createNotifier({ enabled: opts.out === undefined && config.notify !== false });
  const ctx: ExecCtx = {
    json,
    write,
    paint,
    notify,
    timing: new ToolTiming(),
    startedAt: Date.now(),
    exitCode: 0,
  };

  // SIGINT unwinds gracefully: the kernel aborts fail-closed (pending
  // approvals deny, the abandoned turn's log is repaired before run_failed),
  // the finally below still disposes background jobs, and --json consumers
  // get the machine-readable run_error line.
  const agent = kernel.agent;
  const onSigint = (): void => agent.abort();
  process.on('SIGINT', onSigint);
  try {
    const finished = new Promise<void>((resolve) => {
      const unsubscribe = agent.subscribe((event: KernelEvent) => {
        handleEvent(ctx, agent, event);
        if (event.type === 'phase' && event.phase === 'idle') {
          unsubscribe();
          resolve();
        }
      });
    });
    await agent.prompt(prompt);
    await finished;
    // Long headless turns end while the user is elsewhere — same cue family
    // as the old turn-notifier (30s completion threshold).
    const elapsed = Date.now() - ctx.startedAt;
    if (ctx.exitCode === 0 && elapsed >= 30_000) {
      notify('任务已完成', `本轮耗时约 ${Math.max(1, Math.round(elapsed / 60000))} 分钟，回到终端查看结果`);
    }
  } finally {
    process.off('SIGINT', onSigint);
    await kernel.jobs.dispose().catch(() => undefined);
  }
  process.exitCode = ctx.exitCode;
}

interface ExecCtx {
  json: boolean;
  write: (text: string) => void;
  paint: Paint;
  notify: (title: string, body: string) => void;
  timing: ToolTiming;
  startedAt: number;
  exitCode: number;
}

/** One event → output/exit-code decision (JSON 面与人类面在此分叉). */
function handleEvent(ctx: ExecCtx, agent: AgentSession, event: KernelEvent): void {
  if (event.type === 'run_failed') {
    // 归类单看 aborted：SIGINT 真正解绕算中断（130），其余是失败（1）。
    if (event.aborted) {
      emitControl(ctx, { type: 'notice', text: '任务已中断（SIGINT）；会话日志保留到中断前' });
      ctx.exitCode = 130;
    } else {
      emitControl(ctx, { type: 'run_error', message: event.message });
      ctx.notify('任务出错', event.message.slice(0, 120));
      ctx.exitCode = 1;
    }
    return;
  }
  if (ctx.json) {
    ctx.write(`${JSON.stringify(event)}\n`);
    return;
  }
  renderHuman(ctx, agent, event);
}

function emitControl(ctx: ExecCtx, event: ExecControlEvent): void {
  if (ctx.json) ctx.write(`${JSON.stringify(event)}\n`);
  else if (event.type === 'notice') ctx.write(`${ctx.paint.dim(`⟳ ${event.text}`)}\n`);
  else console.error(`出错：${event.message}`);
}

function renderHuman(ctx: ExecCtx, agent: AgentSession, event: KernelEvent): void {
  const { write, paint, timing } = ctx;
  switch (event.type) {
    case 'text_delta':
      write(event.text);
      break;
    case 'llm_retry':
      write(`\n${paint.dim(`⟳ ${retryNotice(event.error, event.attempt, event.maxRetries)}`)}\n`);
      break;
    case 'empty_completion':
      write(`\n${paint.dim(`⟳ ${emptyCompletionNotice(event.finishReason, event.attempt, event.maxRetries)}`)}\n`);
      break;
    case 'message':
      if (event.message.content.length > 0) write('\n');
      break;
    case 'tool_call_start':
      timing.start(event.call.id);
      write(`${toolStartLine(paint, event.call)}\n`);
      break;
    case 'tool_call_result': {
      const duration = timing.finish(event.call.id);
      for (const line of toolDoneLines(paint, event.call, event.result.content, duration)) write(`${line}\n`);
      break;
    }
    case 'compaction':
      if (event.progress.state === 'start') write(`${paint.dim('⟳ 上下文超阈，自动压缩中…')}\n`);
      else if (event.progress.state === 'done') write(`${paint.dim(`⟳ 已自动压缩 — 保留 ${event.progress.retained ?? 0} 条最近消息`)}\n`);
      break;
    case 'notice':
      write(`${paint.dim(`⟳ ${event.text}`)}\n`);
      break;
    case 'done':
      // exec prints only the status one-liner (headless consumers get no
      // max-turns escape-hatch hint); elapsed spans the whole exec.
      write(`\n${statusLine(paint, event.stopReason, agent.usageSnapshot(), Date.now() - ctx.startedAt)}\n`);
      break;
    default:
      break;
  }
}
