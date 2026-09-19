import { createInterface } from 'node:readline/promises';
import type { OpenAICompatClient } from '@nova-agent/ai';
import { createAgentKernel, type ApprovalMode, type Kernel } from '@nova-agent/plugins';
import {
  type AgentSession,
  type AskResult,
  type KernelEvent,
} from '@nova-agent/core';
import { detectCaps } from '@nova-agent/tui';
import { awaitIdle, createProvider, toKernelConfig } from './kernel-boot.js';
import { type Config } from './config.js';
import { createModelListCache } from './commands.js';
import { modelListRows, type ThemeName } from './command-core.js';
import { runAgentCommand, type CommandPorts } from './command-runner.js';
import {
  approvalLabel,
  approvalPromptText,
  banner,
  emptyCompletionNotice,
  maxTurnsHint,
  resolvePaint,
  retryNotice,
  statusLine,
  toolArgSummary,
  toolDoneLines,
  toolLabel,
  toolStartLine,
  ToolTiming,
  type Paint,
} from './lines.js';
import { createNotifier } from './notify.js';
import { ReplProgress } from './repl-progress.js';
import { Spinner } from './spinner.js';
import { cliVersion } from './version.js';

export interface ReplOptions {
  rootDir: string;
  config: Config;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
  /** --theme 覆盖 config 的 ui.theme。 */
  theme?: ThemeName;
}

/**
 * Line source built on raw 'line' events instead of rl.question(): piped
 * stdin reaches EOF while the REPL is busy streaming, and a pending
 * question() would reject with "readline was closed". The queue keeps lines
 * delivered early and hands them out one at a time.
 */
export class LineSource {
  private queue: string[] = [];
  private notify: (() => void) | undefined;
  private closed = false;

  constructor(
    private readonly rl: ReturnType<typeof createInterface>,
    private readonly interactive: boolean,
  ) {
    this.rl.on('line', (line: string) => {
      this.queue.push(line);
      const wake = this.notify;
      this.notify = undefined;
      wake?.();
    });
    this.rl.on('close', () => {
      this.closed = true;
      const wake = this.notify;
      this.notify = undefined;
      wake?.();
    });
  }

  async next(prompt: string): Promise<string | null> {
    if (this.queue.length > 0) return this.queue.shift() ?? null;
    if (this.closed) return null;
    this.rl.setPrompt(prompt);
    this.rl.prompt();
    // readline only renders prompts in terminal mode; echo manually for pipes.
    if (!this.interactive) process.stdout.write(prompt);
    return new Promise<string | null>((resolve) => {
      this.notify = () => {
        if (this.queue.length > 0) resolve(this.queue.shift() ?? null);
        else resolve(null); // closed
      };
    });
  }

  /**
   * Resolve a pending next() with null WITHOUT closing the stream: an
   * interrupt (Ctrl+C during an approval prompt) cancels only that wait, so
   * the caller's null-handling path (approval → deny) runs while the REPL
   * keeps reading lines afterwards.
   */
  cancelPending(): void {
    const wake = this.notify;
    this.notify = undefined;
    wake?.();
  }
}

/**
 * 行内审批答案解析：y/a 前缀=允许/总是，否定词（n/no/nope/nah）后跟的整句
 * 作为拒绝理由回流给模型（与 TUI 弹窗同一 AskResult 形态）；其余输入一律
 * fail-closed 拒绝。
 */
export function parseApprovalAnswer(raw: string): AskResult {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (lower.startsWith('a')) return 'always';
  if (lower.startsWith('y')) return 'allow';
  const tokens = text.split(/\s+/);
  const head = (tokens[0] ?? '').toLowerCase();
  if (head === 'n' || head === 'no' || head === 'nope' || head === 'nah') {
    const reason = tokens.slice(1).join(' ').trim();
    return reason.length > 0 ? { answer: 'deny', reason } : 'deny';
  }
  return 'deny';
}

/**
 * readline REPL（M11 内核消费者）：主循环永远是行的唯一读者——提交走
 * `agent.prompt()`（内核后台跑轮，运行中再输入自动入队），呈现走
 * `subscribe` 事件回调，审批以事件到达、下一条输入路由作答。旧 REPL 的
 * 「for-await 消费事件 + ask 内嵌读行」两把簿记在批1c 后都归内核。
 */
export async function startRepl(opts: ReplOptions): Promise<void> {
  const { rootDir, config } = opts;
  const caps = detectCaps();
  let themeName: ThemeName = opts.theme ?? config.ui?.theme ?? 'dark';
  let paint: Paint = resolvePaint(themeName);
  let useColor = caps.color && themeName !== 'plain';

  const client: OpenAICompatClient = createProvider(config);
  let kernel: Kernel;
  let agent: AgentSession;
  let unsubscribe: (() => void) | undefined;

  // switch_workspace 的模型侧入口：kernel.setWorkspace 重指工具根/文档/
  // 技能并重建 host（单源在装配工厂），这里只剩一行反馈。
  async function applyWorkspace(dir: string): Promise<void> {
    await kernel.setWorkspace(dir);
    console.log(paint.dim(`  ✓ 工作区已切换到 ${dir}`));
  }

  kernel = await createAgentKernel({
    rootDir,
    provider: client,
    config: toKernelConfig(config, opts.approvalOverride),
    ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    workspace: { onChange: (dir: string) => applyWorkspace(dir) },
  });
  client.setSessionId(kernel.agent.session.id);
  agent = kernel.agent;

  if (opts.resumeFile) {
    console.log(`resumed ${agent.messages.length} messages from ${agent.session.file}`);
    for (const warning of agent.session.warnings) console.log(paint.yellow(`  ${warning}`));
  }
  const pluginNames = [...new Set(kernel.host.toolEntries.map((entry) => entry.plugin))].join(',') || 'none';
  banner(paint, {
    model: client.model,
    approval: `${approvalLabel(kernel.permission.approvalMode)}${opts.approvalOverride !== undefined ? '（--approval）' : ''}`,
    plugins: pluginNames,
    sessionFile: agent.session.file,
    rootDir,
    version: cliVersion(),
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = new LineSource(rl, process.stdin.isTTY === true);
  const spinner = new Spinner(useColor, paint);
  const prog = new ReplProgress({
    paint: () => paint,
    useColor,
    spinner,
    write: (chunk) => process.stdout.write(chunk),
    writeln: (line) => console.log(line),
    cols: () => process.stdout.columns ?? 80,
  });
  const timing = new ToolTiming();
  const notify = createNotifier({ enabled: config.notify !== false });
  const fetchModelList = createModelListCache(() => client.listModels());

  /** True while blocked on a sub-prompt (/model pick …): Ctrl+C cancels only that wait. */
  let subPromptPending = false;
  /** The approval modal awaiting its answer (next typed line routes here). */
  let pendingApprovalId: string | undefined;
  let turnStartedAt = 0;

  rl.on('SIGINT', () => {
    if (pendingApprovalId !== undefined) {
      // 内核 abort 同步 fail-close 挂起审批（旧 REPL 的 cancelPending 语义
      // 在内核侧有了正式对应）——轮解绕、审批按拒绝收敛。
      pendingApprovalId = undefined;
      agent.abort();
      console.log(paint.yellow('  已中断（审批按拒绝处理）'));
      return;
    }
    if (subPromptPending) {
      subPromptPending = false;
      lines.cancelPending();
      return;
    }
    if (agent.running || agent.status === 'compacting') {
      agent.abort();
      return;
    }
    console.log();
    rl.close();
  });

  /** 事件呈现委派 ReplProgress（瞬态行）+ console 落行；簿记/日志已归内核。 */
  function renderEvent(event: KernelEvent): void {
    switch (event.type) {
      case 'turn_start':
        prog.startTurn();
        break;
      case 'text_delta':
        prog.onText(event.text);
        break;
      case 'reasoning_delta':
        prog.onReasoning(event.text);
        break;
      case 'llm_retry':
        prog.beforeRow();
        console.log(paint.dim(`  ⟳ ${retryNotice(event.error, event.attempt, event.maxRetries)}`));
        break;
      case 'empty_completion':
        prog.beforeRow();
        console.log(paint.dim(`  ⟳ ${emptyCompletionNotice(event.finishReason, event.attempt, event.maxRetries)}`));
        break;
      case 'message':
        prog.beforeRow();
        if (event.message.content.length > 0) process.stdout.write('\n');
        break;
      case 'tool_call_start':
        prog.onToolCallStart(event.call.name, event.call.id);
        timing.start(event.call.id);
        console.log(toolStartLine(paint, event.call));
        break;
      case 'tool_call_result': {
        const duration = timing.finish(event.call.id);
        prog.onToolCallEnd();
        for (const line of toolDoneLines(paint, event.call, event.result.content, duration)) console.log(line);
        spinner.start();
        break;
      }
      case 'tool_progress':
        prog.onToolProgress(event.text);
        break;
      case 'subagent_update':
        prog.onSubagentProgress(event.progress);
        break;
      case 'approval_request': {
        pendingApprovalId = event.request.id;
        prog.beforeRow();
        for (const line of event.request.preview ?? []) console.log(paint.dim(`  ${line}`));
        const argsPreview = toolArgSummary(event.request.call.rawArgs, 160);
        const ask = approvalPromptText(event.request.kind, toolLabel(event.request.call.name), argsPreview);
        if (ask.alwaysScopeNote.length > 0) console.log(paint.dim(ask.alwaysScopeNote));
        notify('需要审批', `${toolLabel(event.request.call.name)} · ${toolArgSummary(event.request.call.rawArgs, 80)}`);
        console.log(paint.yellow(ask.prompt));
        break;
      }
      case 'approval_resolved':
        if (pendingApprovalId === event.id) pendingApprovalId = undefined;
        break;
      case 'queue_update':
        if (event.items.length > 0) console.log(paint.dim(`  ⧉ 已排队 ${event.items.length} 条，本轮结束后自动处理`));
        break;
      case 'compaction': {
        if (event.progress.trigger === 'manual') break; // /compact 自己报告
        if (event.progress.state === 'start') console.log(paint.yellow('  ⟳ 上下文超过阈值，自动压缩中…'));
        else if (event.progress.state === 'done') {
          console.log(`  已自动压缩 — 会话原位压缩（日志保留完整历史），保留 ${event.progress.retained ?? 0} 条最近用户消息`);
        }
        break;
      }
      case 'notice':
        console.log(paint.dim(`  ⟳ ${event.text}`));
        break;
      case 'run_failed':
        prog.onAbort();
        if (event.aborted) {
          console.log(paint.yellow('  已中断'));
        } else {
          console.error(paint.red(`  出错：${event.message}`));
          console.log(paint.dim('  ⟳ 未完成的回答未写入会话日志（resume 后不可见）'));
          if (turnStartedAt > 0 && Date.now() - turnStartedAt >= 5_000) {
            notify('任务出错', event.message.slice(0, 120));
          }
        }
        break;
      case 'done': {
        prog.endTurn();
        const elapsed = Date.now() - turnStartedAt;
        console.log(statusLine(paint, event.stopReason, agent.usageSnapshot(), elapsed));
        if (event.stopReason === 'max_turns') console.log(paint.dim(maxTurnsHint(config.maxTurns)));
        else if (event.stopReason === 'complete' && elapsed >= 15_000) {
          notify('任务已完成', `本轮耗时约 ${Math.max(1, Math.round(elapsed / 60000))} 分钟，回到终端查看结果`);
        }
        console.log();
        break;
      }
      default:
        break;
    }
  }

  function bindSession(next: AgentSession): void {
    unsubscribe?.();
    agent = next;
    unsubscribe = next.subscribe(renderEvent);
  }
  bindSession(kernel.agent);

  /** 一句话下发（普通输入与 `/skill` 展开的提示词同走这里）。 */
  async function submit(text: string): Promise<void> {
    turnStartedAt = Date.now();
    prog.resetReasoning();
    // 提交 + 起跑（或入队）全在内核；主循环立刻回到读行——运行中可继续输入。
    await agent.prompt(text);
  }

  /**
   * 斜杠命令：语义全在 `command-runner`（与 TUI 共用一份），这里只出端口——
   * note 走 stdout、模型选择走序号提问、清屏是 `console.clear()`。
   * 返回 false = 退出主循环。
   */
  const commandPorts: CommandPorts = {
    kernel,
    client,
    config,
    approvalOverride: opts.approvalOverride,
    theme: () => themeName,
    setTheme: (theme) => {
      themeName = theme;
      paint = resolvePaint(theme);
      useColor = caps.color && theme !== 'plain';
    },
    note: (text) => {
      for (const row of text.split('\n')) console.log(row);
    },
    fetchModels: () => fetchModelList(),
    pickModel: async (models) => {
      console.log(`当前模型：${client.model}`);
      for (const row of modelListRows(client.model, [...models])) console.log(row);
      subPromptPending = true;
      let raw: string | null;
      try {
        raw = await lines.next(paint.cyan('输入序号切换模型，回车取消：'));
      } finally {
        subPromptPending = false;
      }
      const pick = raw?.trim();
      if (pick === null || pick === undefined || pick.length === 0) return undefined;
      const idx = Number.parseInt(pick, 10);
      const model = Number.isInteger(idx) ? models[idx - 1] : undefined;
      if (model === undefined) {
        console.log(`无效序号：${pick}`);
        return undefined;
      }
      return model;
    },
    bindSession,
    clear: () => {
      console.clear();
      console.log('（已清屏，会话记录保留在磁盘）');
    },
    modeHint: '（repl 遵循 config.json 的 tools.code.mode）',
    exit: async () => {
      // 优雅收尾：轮在跑就先中断并等它解绕（挂起审批 fail-close、半截日志
      // 修复都在内核 abort 路径里）——退出绝不把进行中的轮丢在半路。
      if (agent.running) {
        agent.abort();
        await awaitIdle(agent);
      }
    },
  };

  async function runCommand(input: string): Promise<boolean> {
    const outcome = await runAgentCommand(input, commandPorts);
    if (outcome === 'exit') return false;
    // `/skill <name>` 展开成提示词：与普通输入同一路径下发（此前它落进
    // 「未知命令」——两壳各写一份语义的直接后果）。
    if (typeof outcome === 'object') await submit(outcome.prompt);
    return true;
  }

  for (;;) {
    const line = await lines.next(paint.cyan('› '));
    if (line === null) {
      // 管道脚本 EOF：在途/排队的轮跑完再退（旧 REPL 逐行串行天然如此，
      // 内核的队列语义下需显式收尾，否则脚本永远看不到最后一条的输出）。
      await awaitIdle(agent);
      break;
    }
    let input = line.trim();
    if (input.length === 0) continue;

    if (pendingApprovalId !== undefined) {
      // 审批挂起期下一条输入是答案不是任务：未识别为 y/a/n 的整句按拒绝处理
      //（fail-closed），并明确告知，绝不静默吞任务。
      const looksLikeAnswer = /^(y|a|n)/i.test(input);
      if (!looksLikeAnswer) console.log(paint.dim('  （未识别为 y/a/n，审批按拒绝处理）'));
      const id = pendingApprovalId;
      pendingApprovalId = undefined;
      if (!agent.resolveApproval(id, parseApprovalAnswer(input))) console.log(paint.dim('  （该审批已失效）'));
      continue;
    }

    if (input.startsWith('/')) {
      if (!(await runCommand(input))) break;
      continue;
    }

    await submit(input);
  }

  rl.close();
  unsubscribe?.();
  await agent.dispose().catch(() => undefined);
  // Kill background jobs before the process exits, or the spawned shells
  // outlive the session (dsh jobs dispose contract).
  await kernel.jobs.dispose().catch(() => undefined);
}
