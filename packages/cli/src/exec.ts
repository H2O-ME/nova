import {
  type AgentSession,
  type AgentSurfaceRuntime,
  type KernelEvent,
} from '@nova-agent/core';
import { createNotifier } from './notify.js';
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
import type { BuiltinSurface } from './surface-host.js';

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
  /** The task to execute in one non-interactive run. */
  prompt: string;
  /** Emit every kernel event as JSONL instead of human-readable text. */
  json: boolean;
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
export async function runExec(runtime: AgentSurfaceRuntime, config: Config, opts: ExecOptions): Promise<void> {
  const { prompt, json } = opts;
  const kernel = runtime.kernel;
  const write = opts.out ?? ((text: string) => process.stdout.write(text));
  // 调色板装配单源 resolvePaint（与 repl 同路）：尊重 ui.theme 与
  // NO_COLOR/TERM=dumb；注入 sink（测试）恒无色。
  const paint: Paint = opts.out === undefined ? resolvePaint(config.ui?.theme ?? 'dark') : plainPaint;

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

/**
 * `nova exec "<task>"` — the headless surface: one task, event stream out
 * (`KernelEvent` JSONL under `--json`), process exit code as the verdict.
 *
 * The task text is the first positional after `exec`, or stdin when piped;
 * nobody can answer an approval prompt here, so the assembly runs the session
 * under the `never` policy (read-only tools still work) and auto-compaction
 * gates INSIDE every request (`perRequestCompact`) — one run spans the whole
 * task, boundary checks could never fire.
 */
export function execSurface(config: Config): BuiltinSurface {
  return {
    surface: {
      name: 'exec',
      claim: (request) => request.flags.positional[0] === 'exec',
      start: async (runtime) => {
        const prompt = await execPrompt(runtime.request.flags.positional);
        if (prompt === undefined) return;
        await runExec(runtime, config, { prompt, json: runtime.request.flags.json });
      },
    },
    boot: {
      kernel: () => ({ perRequestCompact: true }),
      afterBoot: (kernel) => kernel.permission.setPolicy('never'),
    },
  };
}

/** `nova exec "<task>"`, or the task piped in on stdin (CI-friendly). */
async function execPrompt(positional: readonly string[]): Promise<string | undefined> {
  let prompt = positional.slice(1).join(' ').trim();
  if (prompt.length === 0 && process.stdin.isTTY !== true) prompt = (await readStdin()).trim();
  if (prompt.length === 0) {
    console.error('usage: nova exec "<task>"（或通过管道传入任务文本）');
    process.exitCode = 1;
    return undefined;
  }
  return prompt;
}

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
  });
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
