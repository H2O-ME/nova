import { createInterface } from 'node:readline/promises';
import type {
  AgentSession,
  AgentSurfaceRuntime,
  AgentSurfaceUi,
  AskUserQuestionAnswer,
  KernelEvent,
} from '@nova-agent/core';
import { detectCaps } from './term-text.js';
import { awaitIdle } from './kernel-boot.js';
import { parseApprovalAnswer, parseQuestionAnswer, questionBatchLines, assembleAnswers } from './repl-answers.js';
import { type Config } from './config.js';
import { modelListRows, themeTarget, type ThemeName } from './command-core.js';
import type { BuiltinSurface } from './surface-host.js';
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

/**
 * `nova --repl` — the readline surface, as an `AgentSurface` like every other.
 *
 * 工作区切换的反馈由 `surface-host.ts` 的 holder 接回这里（P4-C：契约里的
 * `onWorkspaceChanged` 从此有实现方）；paint 由 start 时回填，供那行反馈上色。
 */
export function replSurface(config: Config): BuiltinSurface {
  const feedback: { paint?: Paint } = {};
  return {
    surface: {
      name: 'repl',
      interactive: true,
      claim: (request) => request.flags.repl || !request.interactive,
      onWorkspaceChanged: (dir) => {
        console.log(feedback.paint?.dim(`  ✓ 工作区已切换到 ${dir}`) ?? `  ✓ 工作区已切换到 ${dir}`);
      },
      start: (runtime) => startRepl(runtime, config, feedback),
    },
  };
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

export { parseApprovalAnswer, parseQuestionAnswer } from './repl-answers.js';

/**
 * readline REPL（M11 内核消费者）：主循环永远是行的唯一读者——提交走
 * `agent.prompt()`（内核后台跑轮，运行中再输入自动入队），呈现走
 * `subscribe` 事件回调，审批以事件到达、下一条输入路由作答。旧 REPL 的
 * 「for-await 消费事件 + ask 内嵌读行」两把簿记在批1c 后都归内核。
 */
export async function startRepl(
  runtime: AgentSurfaceRuntime,
  config: Config,
  feedback: { paint?: Paint },
): Promise<void> {
  const rootDir = runtime.request.rootDir;
  const kernel = runtime.kernel;
  const caps = detectCaps();
  let themeName: ThemeName = themeTarget(runtime.theme) ?? 'dark';
  let paint: Paint = resolvePaint(themeName);
  let useColor = caps.color && themeName !== 'plain';
  feedback.paint = paint;

  let agent: AgentSession;
  let unsubscribe: (() => void) | undefined;

  agent = kernel.agent;

  if (runtime.request.flags.resumeFile !== undefined) {
    console.log(`resumed ${agent.messages.length} messages from ${agent.session.file}`);
    for (const warning of agent.session.warnings) console.log(paint.yellow(`  ${warning}`));
  }
  const pluginNames = [...new Set(kernel.host.toolEntries.map((entry) => entry.plugin))].join(',') || 'none';
  banner(paint, {
    model: runtime.model(),
    approval: `${approvalLabel(agent.approvalMode ?? 'read-only')}${runtime.request.flags.approval !== undefined ? '（--approval）' : ''}`,
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

  /** True while blocked on a sub-prompt (/model pick …): Ctrl+C cancels only that wait. */
  let subPromptPending = false;
  /** The approval modal awaiting its answer (next typed line routes here). */
  let pendingApprovalId: string | undefined;
  /**
   * The question batch awaiting answers, and how far through it we are. The
   * kernel allows one outstanding batch, so these are two scalars rather than a
   * map: the card the browser draws, in a terminal.
   */
  let pendingQuestion: { id: string; at: number } | undefined;
  const questionAnswers: AskUserQuestionAnswer['answers'] = [];
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
      case 'question_request':
        // 开一组问题：整批一次渲染，答案按行读取（下一行输入路由到这里）。
        pendingQuestion = { id: event.request.id, at: 0 };
        questionAnswers.length = 0;
        prog.beforeRow();
        for (const line of questionBatchLines(paint, event.request.questions, 0)) console.log(line);
        break;
      case 'question_resolved':
        if (pendingQuestion?.id === event.id) pendingQuestion = undefined;
        questionAnswers.length = 0;
        break;
      case 'queue_update':
        // Not "本轮结束后": an interjection the running loop picks up is read by
        // the model at the NEXT step boundary of the CURRENT run. The queued line
        // only becomes its own run when the current one ends early (abort), which
        // is what the second clause covers.
        if (event.items.length > 0) console.log(paint.dim(`  ⧉ 已排队 ${event.items.length} 条，当前运行的下一步即可读到`));
        break;
      case 'compaction': {
        if (event.progress.trigger === 'manual') {
          // /compact 经 kernel runner 执行，压缩进度就是它的工作汇报（壳不再
          // 自带一份文案）；拒绝与失败经 command 行到达。
          if (event.progress.state === 'start') console.log(paint.yellow('  ⟳ 正在压缩会话…'));
          else if (event.progress.state === 'done') {
            console.log(`  已压缩 — 会话原位压缩（日志保留完整历史），保留 ${event.progress.retained ?? 0} 条最近用户消息`);
          }
          break;
        }
        if (event.progress.state === 'start') console.log(paint.yellow('  ⟳ 上下文超过阈值，自动压缩中…'));
        else if (event.progress.state === 'done') {
          console.log(`  已自动压缩 — 会话原位压缩（日志保留完整历史），保留 ${event.progress.retained ?? 0} 条最近用户消息`);
        }
        break;
      }
      case 'command':
        // 注册命令（/goal 与第三方）经 kernel runner 汇报：done 行携带命令
        // 自己 log 的输出；run 行与空 done 不打印（/compact 的进度由上面的
        // compaction 行承担）。
        if (event.phase === 'done' && event.text !== undefined) {
          for (const line of event.text.split('\n')) console.log(paint.dim(`  ${line}`));
        }
        break;
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
   * 斜杠命令：语义全在 `command-runner`（与每个 surface 共用一份，经
   * `runtime.commands`），这里只实现 core 的呈现契约 `AgentSurfaceUi`——
   * note 走 stdout、模型选择走序号提问、清屏是 `console.clear()`。
   */
  const ui: AgentSurfaceUi = {
    theme: () => themeName,
    setTheme: (theme) => {
      const target = themeTarget(theme);
      if (target === undefined) return;
      themeName = target;
      paint = resolvePaint(target);
      useColor = caps.color && target !== 'plain';
      feedback.paint = paint;
    },
    note: (text) => {
      for (const row of text.split('\n')) console.log(row);
    },
    pickModel: async (models) => {
      console.log(`当前模型：${runtime.model()}`);
      for (const row of modelListRows(runtime.model(), [...models])) console.log(row);
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
    modeHint: '（repl 遵循 config.json 的 tools.code.mode；PTC 插件被关闭时回落原生）',
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
    const outcome = await runtime.commands.run(input, ui);
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

    if (pendingQuestion !== undefined) {
      // 提问挂起期下一条输入是该题的答案（不是新任务）：空行 = 跳过该题，
      // 最后一题答完即整批提交。绝不静默吞任务——仍在提问就仍在这一支里。
      const request = agent.pendingQuestions().find((item) => item.id === pendingQuestion?.id);
      const question = request?.questions[pendingQuestion.at];
      if (request === undefined || question === undefined) {
        // 批次已被内核收敛（中断/关闭）：告知并放行这一行，不假装它被消费。
        pendingQuestion = undefined;
        console.log(paint.dim('  （该问题已失效）'));
        continue;
      }
      questionAnswers.push(parseQuestionAnswer(question, input));
      if (pendingQuestion.at + 1 < request.questions.length) {
        pendingQuestion.at += 1;
        for (const line of questionBatchLines(paint, request.questions, pendingQuestion.at)) console.log(line);
        continue;
      }
      const id = request.id;
      pendingQuestion = undefined;
      const answer = assembleAnswers(request.questions, questionAnswers);
      questionAnswers.length = 0;
      if (!agent.resolveQuestion(id, answer)) console.log(paint.dim('  （该问题已失效）'));
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
