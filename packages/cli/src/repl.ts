import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { detectCaps, styledWidth } from '@nova-agent/tui';
import { errMessage,
  runAgent,
  Session,
  type AgentEvent,
  type AgentMessage,
  type SubagentProgress,
  type UsageStats,
} from '@nova-agent/core';
import { type ApprovalMode, type AskFn } from '@nova-agent/plugins';
import { newSessionDir, type Config } from './config.js';
import { writeAgentsMd } from './agents-md.js';
import { compactSession } from './compact.js';
import { COMMAND_SPECS, modeOverviewRows } from './commands.js';
import { resolvePalette } from '@nova-agent/tui-view';
import {
  cacheHitPct,
  lastCacheHitPct,
  MODEL_LIST_EMPTY,
  modelListError,
  nextApprovalMode,
  openFreshSession,
  pluginCommandLine,
  pluginToolLine,
} from './command-core.js';
import { expandSkillInvocation } from './context.js';
import { recordSessionWorkspace } from './sessions.js';
import { createNotifier } from './notify.js';
import { createSessionRuntime } from './session-runtime.js';
import {
  commitUserMessage,
  createRunnerBookkeeping,
  createTurnNotifier,
  createUsageAnchors,
  emptyCompletionNotice,
  isUserInterrupt,
  llmRetryNotice,
  resetUsageAnchors,
  turnStopLines,
} from './runner-loop.js';
import {
  approvalLabel,
  banner,
  fitTail,
  permissionLabel,
  toolArgSummary,
  toolDoneLine,
  toolLabel,
  toolStartLine,
} from './ui.js';
import {
  agentRunBase,
  approvalEffectPreview,
  approvalNotifyBody,
  approvalPrompt,
  attachHooks,
  createApprovalService,
  createAutoCompact,
  persistMissingToolResults,
  ToolTiming,
} from './runner-shared.js';
import { Spinner } from './spinner.js';
import { cliVersion } from './version.js';

export interface ReplOptions {
  rootDir: string;
  config: Config;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
  /** --theme 覆盖 config 的 ui.theme。 */
  theme?: 'dark' | 'light' | 'plain';
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

export async function startRepl(opts: ReplOptions): Promise<void> {
  const { rootDir, config } = opts;
  // 主题解析单源（tui-view.resolvePalette）；/theme 运行中可切换。
  const caps = detectCaps();
  const useColor = caps.color;
  let themeName: 'dark' | 'light' | 'plain' = opts.theme ?? config.ui?.theme ?? 'dark';
  let paint = resolvePalette(themeName, caps);

  // switch_workspace 的运行侧回调（late-bound：createSessionRuntime 先于
  // permission/applyWorkspace 就绪，回调只在工具执行时触发）。
  let applyWorkspaceRef: ((dir: string) => Promise<void>) | undefined;
  const rt = await createSessionRuntime({
    rootDir,
    config,
    resumeFile: opts.resumeFile,
    approvalOverride: opts.approvalOverride,
    workspace: {
      onChange: (dir: string) => {
        if (applyWorkspaceRef === undefined) return Promise.resolve();
        return applyWorkspaceRef(dir);
      },
    },
    // Nested subagent visibility: the latch (declared below) binds nested
    // rows to the current parent `subagent` call. The callback only FIRES
    // after the latch exists — nested runs happen mid-turn, long after.
    // replSubagentProgress itself no-ops unless the latch is pinned.
    subagentProgress: (progress) => replSubagentProgress(progress),
  });
  let messages: AgentMessage[] = rt.messages;
  let session: Session = rt.session;
  const client = rt.client;
  /** 站点模型目录缓存由 runtime 单源装配（/model 用）。 */
  const fetchModelList = rt.fetchModelList;
  const stats: UsageStats = rt.stats;
  const jobs = rt.jobs;
  // 可变：switch_workspace 工具会在任务中重指工作区（rebuildHost 重建工具根）。
  let workspaceRoot = rootDir;
  let host = rt.host;
  let skills = rt.skills;

  if (opts.resumeFile) {
    console.log(`resumed ${messages.length} messages from ${session.file}`);
    for (const warning of session.warnings) console.log(paint.yellow(`  ${warning}`));
  }
  const approvalMode = rt.approvalMode;
  // seedContextFragment comes from the runtime; /new reuses it with the
  // CURRENT session/messages bindings (never rt.session — see its docstring).
  const seedContextFragment = rt.seedContextFragment;
  // /new creates a fresh session in the current date bucket (cross-day runs).
  let sessionsDir = newSessionDir();

  const pluginNames = [...new Set(host.toolEntries.map((e) => e.plugin))].join(',') || 'none';
  banner(paint, {
    model: client.model,
    approval: approvalMode + (opts.approvalOverride !== undefined ? ' (--approval)' : ''),
    plugins: pluginNames,
    sessionFile: session.file,
    rootDir,
    version: cliVersion(),
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = new LineSource(rl, process.stdin.isTTY === true);
  const spinner = new Spinner(useColor);
  let aborter: AbortController | undefined;
  let streaming = false;
  /** True while the REPL is blocked on an approval prompt (lines.next). */
  let approvalPending = false;
  /** True while blocked on a sub-prompt (/model pick …): Ctrl+C cancels only that wait. */
  let subPromptPending = false;
  /** Abort source for an in-flight /compact (SIGINT unwinds it, not the REPL). */
  let compactAbort: AbortController | undefined;

  rl.on('SIGINT', () => {
    if (approvalPending) {
      // An interrupt during the approval prompt cancels the wait (the null
      // answer reads as deny) AND unwinds the run — otherwise the prompt
      // stays up until a y/n/a is typed and the abort signal never lands.
      approvalPending = false;
      lines.cancelPending();
      aborter?.abort();
      console.log(paint.yellow('  已中断（审批按拒绝处理）'));
      return;
    }
    if (subPromptPending) {
      // Ctrl+C during a sub-prompt (/model pick …) cancels just that wait —
      // the REPL keeps running (same contract as the approval wait).
      subPromptPending = false;
      lines.cancelPending();
      return;
    }
    if (compactRunning) {
      // Interrupting a compaction aborts the summarizer request; the
      // /compact handler reports the failure and the REPL survives.
      compactAbort?.abort();
      return;
    }
    if (streaming) {
      aborter?.abort();
      return;
    }
    console.log();
    rl.close();
  });

  /** 审批等待期弹系统通知：REPL 停在提示符上看起来像卡住，其实是在等确认。 */
  const notify = createNotifier({ enabled: config.notify !== false });
  const askApproval: AskFn = async (call, kind) => {
    // Best-effort effect preview (edit_file's diff etc.) above the prompt —
    // the user approves what the call WILL do, not just the arg JSON.
    for (const line of await approvalEffectPreview(host, workspaceRoot, call)) {
      console.log(paint.dim(`  ${line}`));
    }
    // 参数摘要单源 toolArgSummary（与 TUI 弹窗/toast 同一名称感知截断）——
    // 此前 repl 用 raw JSON 硬切 160，同一调用两种观感。
    const argsPreview = toolArgSummary(call.name, call.rawArgs, 160);
    const { prompt, alwaysScopeNote } = approvalPrompt(
      permissionLabel(kind),
      toolLabel(call.name),
      argsPreview,
      kind,
    );
    notify('需要审批', approvalNotifyBody(call));
    approvalPending = true;
    let raw: string | null;
    try {
      raw = await lines.next(paint.yellow(prompt));
    } finally {
      approvalPending = false;
    }
    if (alwaysScopeNote.length > 0 && raw !== null) console.log(paint.dim(alwaysScopeNote));
    if (raw === null) return 'deny';
    const answer = raw.trim().toLowerCase();
    if (answer.startsWith('a')) return 'always';
    if (answer.startsWith('y')) return 'allow';
    return 'deny';
  };
  const permission = createApprovalService(approvalMode, askApproval, () => session);
  let hooks = attachHooks(host, permission, rt.hooksRef);
  /**
   * switch_workspace 的运行侧通道：重指工具根 + 技能/环境片段，重建 host。
   * 与 TUI 的 applyWorkspace 同一契约（新根自下一次工具分发/下一轮生效）。
   * 装配本体在 runtime.buildHost（单源）；这里只接 runner 侧 hooks。
   */
  const applyWorkspace = async (dir: string): Promise<void> => {
    workspaceRoot = dir;
    skills = await rt.reloadWorkspaceContext(dir);
    const next = await rt.buildHost({
      rootDir: workspaceRoot,
      skills,
      workspace: { onChange: (target: string) => applyWorkspace(target) },
    });
    host = next;
    hooks = attachHooks(next, permission, rt.hooksRef);
    console.log(paint.dim(`  ✓ 工作区已切换到 ${dir}`));
  };
  applyWorkspaceRef = applyWorkspace;
  const systemPrompt = rt.systemPrompt;
  const toolTiming = new ToolTiming();
  // 事件消费簿记单源（runner-loop）：日志追加 + usage/锚点（四 runner 同一契约）。
  const anchors = createUsageAnchors();
  const bookkeeping = createRunnerBookkeeping({
    session: () => session,
    stats,
    anchors,
    messages: () => messages,
  });
  const turnNotifier = createTurnNotifier((title, body) => notify(title, body));
  let compactRunning = false;
  let reasoningTail = '';
  let reasoningLive = false;
  let progressTail = '';
  let progressLive = false;
  // Latest foreground `subagent` parent call: the runtime's shared
  // subagentProgress feed maps nested rows here (labels repeat, call ids
  // don't). Pinned at tool_call_start, cleared at tool_call_result.
  const replSubagentLatch: { current: { callId: string } | undefined } = { current: undefined };
  /** Nested subagent visibility (REPL): one dim row per lifecycle moment. */
  const replSubagentProgress = (progress: SubagentProgress): void => {
    if (!useColor || replSubagentLatch.current === undefined) return;    if (progress.type === 'start') {
      console.log(paint.dim(`    ⧉ 子代理 ${progress.label} 启动…`));
    } else if (progress.type === 'tool_call') {
      console.log(paint.dim(`    ⧉ ${progress.label} › ${progress.call.name}`));
    } else if (progress.type === 'done') {
      const u = progress.usage;
      console.log(
        paint.dim(`    ⧉ ${progress.label} 完成 · ${u.turns} 轮 · ${u.toolCalls} 工具 · ${u.promptTokens + u.completionTokens} tok · ${(u.elapsedMs / 1000).toFixed(1)}s`),
      );
    }
  };
  const endReasoningLine = (): void => {
    if (reasoningLive) {
      process.stdout.write('\x1b[0m\n');
      reasoningLive = false;
    }
  };
  /** Wipe the in-place `└ tail` progress row so the next print starts clean. */
  const clearProgressLine = (): void => {
    if (progressLive) {
      process.stdout.write('\r\x1b[2K');
      progressLive = false;
    }
  };

  /**
   * Shared auto-compact orchestration (runner-shared): guards, anchor-reset
   * contract and error containment live there; only the presentation is local.
   */
  const autoCompact = createAutoCompact({
    limit: config.autoCompactTokenLimit,
    request: () => ({ messages, systemPrompt, tools: host.tools }),
    state: {
      isRunning: () => compactRunning,
      setRunning: (v) => {
        compactRunning = v;
      },
      anchors: () => anchors,
      resetAnchors: () => resetUsageAnchors(anchors),
      lastPromptTokens: () => anchors.lastPromptTokens,
      adoptSurface: (surface) => {
        messages = surface;
      },
    },
    // The SIGINT layer hands /compact an abort source; pass its signal through
    // so an interrupt unwinds the summarizer request instead of hanging it.
    compact: (trigger) =>
      compactSession({
        client,
        session,
        messages,
        trigger,
        ...(compactAbort !== undefined ? { signal: compactAbort.signal } : {}),
      }),
    report: {
      preStart: (limit) => console.log(paint.yellow(`预估下轮上下文超过阈值 ${limit}，提前压缩…`)),
      postStart: (tokens, limit) => console.log(paint.yellow(`上下文约 ${tokens} tok，超过自动压缩阈值 ${limit}，正在压缩…`)),
      success: (outcome) => console.log(`已自动压缩 — 会话原位压缩（日志保留完整历史），保留 ${outcome.retained} 条最近用户消息`),
      failure: (err) => console.error(paint.red(`自动压缩失败：${errMessage(err)}`)),
    },
  });
  const { runCompact, maybePreCompact, maybeAutoCompact } = autoCompact;

  /** Shared runAgent kwargs (runner-shared); per-call: signal + tool progress. */
  const agentRun = agentRunBase({
    client,
    session: () => session,
    rootDir: () => workspaceRoot,
    messages: () => messages,
    tools: () => host.tools,
    hooks: () => hooks,
    jobs,
    systemPrompt,
    maxTurns: config.maxTurns,
  });

  const renderEvent = async (event: AgentEvent, requestStartedAt: number): Promise<void> => {
    switch (event.type) {
      case 'turn_start': {
        spinner.start();
        break;
      }
      case 'text_delta': {
        endReasoningLine();
        spinner.stop();
        process.stdout.write(event.text);
        break;
      }
      case 'reasoning_delta': {
        // Single dim status line showing the tail of the reasoning stream
        // (DeepSeek reasoner style); skipped entirely without a TTY. The
        // tail is width-trimmed to one physical row: `\r\x1b[2K` clears
        // exactly that row, and an overwriting wrap would leave garbage.
        if (!useColor) break;
        spinner.stop();
        const maxCols = Math.max(10, (process.stdout.columns ?? 80) - styledWidth('  ⋯ ') - 1);
        reasoningTail = fitTail(`${reasoningTail}${event.text}`.replaceAll('\n', ' ⏎ '), maxCols);
        process.stdout.write(`\r\x1b[2K\x1b[2m  ⋯ ${reasoningTail}`);
        reasoningLive = true;
        break;
      }
      case 'llm_retry': {
        // Already-streamed text cannot be un-printed here; the notice marks
        // the boundary before the retry replays the answer from scratch.
        Object.assign(stats, event.stats);
        endReasoningLine();
        spinner.stop();
        console.log(paint.dim(`  ⟳ ${llmRetryNotice(event.error, event.attempt, event.maxRetries)}`));
        break;
      }
      case 'empty_completion': {
        endReasoningLine();
        spinner.stop();
        console.log(
          paint.dim(`  ⟳ ${emptyCompletionNotice(event.finishReason, event.attempt, event.maxRetries)}`),
        );
        break;
      }
      case 'message': {
        endReasoningLine();
        spinner.stop();
        if (event.message.content.length > 0) process.stdout.write('\n');
        await bookkeeping.apply(event);
        break;
      }
      case 'tool_call_start': {
        endReasoningLine();
        spinner.stop();
        toolTiming.start(event.call.id);
        progressTail = '';
        console.log(toolStartLine(paint, event.call.name, event.call.rawArgs));
        // Reset the per-call subagent latch: only the `subagent` tool binds
        // replSubagentProgress while it runs (nested calls of OTHER parent
        // tools — a PTC run_code dispatching read_file — must NOT).
        replSubagentLatch.current =
          event.call.name === 'subagent' ? { callId: event.call.id } : undefined;
        break;
      }
      case 'tool_call_result': {
        const duration = toolTiming.finish(event.call.id);
        clearProgressLine();
        replSubagentLatch.current = undefined;
        await bookkeeping.apply(event);
        for (const line of toolDoneLine(paint, event.call.name, event.call.rawArgs, event.result.content, duration)) {
          console.log(line);
        }
        spinner.start();
        break;
      }
      case 'usage': {
        await bookkeeping.apply(event);
        break;
      }
      case 'turn_aborted': {
        await bookkeeping.apply(event);
        break;
      }
      case 'done': {
        endReasoningLine();
        clearProgressLine();
        spinner.stop();
        const kind = event.stopReason;
        for (const line of turnStopLines(paint, kind, stats, Date.now() - requestStartedAt, config)) {
          console.log(line);
        }
        break;
      }
    }
  };

  loop: for (;;) {
    const line = await lines.next(paint.cyan('› '));
    if (line === null) break;
    let input = line.trim();
    if (input.length === 0) continue;

    const skillInvocation = await expandSkillInvocation(input, skills);
    if (skillInvocation !== undefined) {
      if (!skillInvocation.ok) {
        console.log(skillInvocation.error);
        continue;
      }
      input = skillInvocation.content;
    }

    if (input.startsWith('/')) {
      const [cmd = ''] = input.split(/\s+/);
      switch (cmd) {
        case '/exit':
        case '/quit':
          break loop;
        case '/help':
          console.log(
            COMMAND_SPECS.map((spec) => `  ${spec.usage.padEnd(24)}${spec.description}`).join('\n'),
          );
          break;
        case '/new': {
          sessionsDir = newSessionDir(); // 跨天运行时归入当天的日期桶
          ({ session, messages } = await openFreshSession({
            sessionsDir,
            rootDir,
            setClientSessionId: (id) => client.setSessionId(id),
            stats,
            anchors,
            recordWorkspace: recordSessionWorkspace,
            seedContext: seedContextFragment,
          }));
          console.log(`新会话：${session.file}`);
          break;
        }
        case '/session': {
          const hit = cacheHitPct(stats.promptTokens, stats.cachedTokens);
          const lastHit = lastCacheHitPct(anchors.lastUsage);
          const compact = config.autoCompactTokenLimit
            ? `阈值 ${config.autoCompactTokenLimit} tok · 上轮 ${anchors.lastPromptTokens} tok`
            : '未启用';
          console.log(
            `文件：${session.file}\n消息 ${messages.length} 条 · ${stats.turns} 轮 · 输入 ${stats.promptTokens} tok · 缓存 ${hit}%${lastHit !== null ? `（上轮 ${lastHit}%）` : ''} · 输出 ${stats.completionTokens} tok\n缓存浪费 ${stats.missTokens} tok（超噪声底 ${stats.missTurns} 轮）\n自动压缩：${compact}`,
          );
          break;
        }
        case '/model': {
          try {
            const models = await fetchModelList();
            if (models.length === 0) {
              console.log(MODEL_LIST_EMPTY);
              break;
            }
            console.log(`当前模型：${client.model}`);
            for (const [i, model] of models.entries()) {
              console.log(`  ${model === client.model ? '❯' : ' '} ${i + 1}. ${model}${model === client.model ? '（当前）' : ''}`);
            }
            subPromptPending = true;
            let raw: string | null;
            try {
              raw = await lines.next(paint.cyan('输入序号切换模型，回车取消：'));
            } finally {
              subPromptPending = false;
            }
            const pick = raw?.trim();
            if (pick === undefined || pick === null || pick.length === 0) {
              console.log('已取消');
              break;
            }
            const idx = Number.parseInt(pick, 10);
            const model = Number.isInteger(idx) ? models[idx - 1] : undefined;
            if (model === undefined) {
              console.log(`无效序号：${pick}`);
              break;
            }
            if (model === client.model) {
              console.log(`已是当前模型：${model}`);
              break;
            }
            client.setModel(model);
            console.log(`模型已切换为 ${model}`);
          } catch (err) {
            console.log(modelListError(err));
          }
          break;
        }
        case '/theme': {
          const arg = input.trim().split(/\s+/)[1];
          if (arg === undefined) {
            console.log(`当前主题：${themeName}（/theme dark|light|plain 切换；NO_COLOR 恒定无色）`);
            break;
          }
          if (arg !== 'dark' && arg !== 'light' && arg !== 'plain') {
            console.log(`未知主题：${arg}（可选 dark / light / plain）`);
            break;
          }
          themeName = arg;
          paint = resolvePalette(arg, caps);
          console.log(`主题已切换为 ${arg}`);
          break;
        }
        case '/plugins': {
          console.log(`审批档位：${approvalLabel(permission.approvalMode)}${opts.approvalOverride !== undefined ? '（来自 --approval）' : ''}`);
          if (host.toolEntries.length === 0) console.log('（没有已注册的工具）');
          for (const entry of host.toolEntries) {
            console.log(`  ${pluginToolLine(entry.plugin, entry.tool.name, permissionLabel(entry.permission))}`);
          }
          for (const entry of host.commandEntries) {
            console.log(`  ${pluginCommandLine(entry.plugin, entry.command.name, entry.command.description)}`);
          }
          break;
        }
        case '/approvals': {
          const next = nextApprovalMode(permission.approvalMode);
          permission.setMode(next as ApprovalMode);
          console.log(`审批档位：${approvalLabel(next)}`);
          break;
        }
        case '/mode': {
          // repl 没有 Tab 切换缝（host 由 runtime 一次性装配），模式来自
          // config 的 tools.code.mode——行语义与 TUI /mode 一致，来源不同。
          const current = rt.codeConfig?.mode ?? 'native';
          console.log(`执行模式 ${paint.dim('· repl 遵循 config.json 的 tools.code.mode（TUI 内可按 Tab 循环切换）')}`);
          for (const row of modeOverviewRows(current)) {
            console.log(`  ${row.current ? paint.cyan(row.text) : paint.dim(row.text)}`);
          }
          break;
        }
        case '/compact': {
          console.log('正在压缩会话…');
          compactAbort = new AbortController();
          try {
            const outcome = await runCompact('manual');
            console.log(
              `已压缩 — 会话原位压缩（日志保留完整历史），摘要 ${outcome.summary.length} 字，保留 ${outcome.retained} 条最近用户消息`,
            );
          } catch (err) {
            // 与主轮同一归类（runner-loop.isUserInterrupt）：signal 触发才算
            // 中断，文案含 "aborted" 的网络超时必须亮原文。
            const aborted = isUserInterrupt(compactAbort?.signal);
            console.error(aborted ? '压缩已中断（会话保持未压缩）' : `压缩失败：${errMessage(err)}`);
          } finally {
            compactAbort = undefined;
          }
          break;
        }
        case '/clear': {
          console.clear();
          console.log('（已清屏，会话记录保留在磁盘）');
          break;
        }
        case '/init': {
          const file = await writeAgentsMd(rootDir);
          console.log(`已写入 ${path.basename(file)}`);
          break;
        }
        default:
          console.log(`未知命令：${cmd}（输入 /help 查看命令）`);
      }
      continue;
    }

    await commitUserMessage(session, messages, input);
    await maybePreCompact();

    aborter = new AbortController();
    streaming = true;
    reasoningTail = '';
    const requestStartedAt = Date.now();
    try {
      for await (const event of runAgent({
        ...agentRun(),
        // Live bash output tail on one in-place dim row (same contract as the
        // reasoning line: \r\x1b[2K clears exactly one physical row, so the
        // tail must be width-trimmed before writing).
        onToolProgress: (text) => {
          if (!useColor) return;
          progressTail = (progressTail + text).slice(-2000);
          const last = progressTail.slice(progressTail.lastIndexOf('\n') + 1).trimEnd();
          if (last.length === 0) return;
          const maxCols = Math.max(10, (process.stdout.columns ?? 80) - styledWidth('  └ ') - 1);
          process.stdout.write(`\r\x1b[2K\x1b[2m  └ ${fitTail(last, maxCols)}\x1b[0m`);
          progressLive = true;
        },
        signal: aborter.signal,
      })) {
        await renderEvent(event, requestStartedAt);
      }
    } catch (err) {
      spinner.stop();
      clearProgressLine();
      // Repair the log before any surface work: the turn may have died with
      // assistant tool_calls unanswered — append synthesized results (same
      // copy core's abandonment synthesis uses) so the log keeps its
      // one-result-per-call contract.
      await persistMissingToolResults(session, messages).catch(() => undefined);
      const message = errMessage(err);
      // 中断归类单源（runner-loop.isUserInterrupt）：以本轮 signal 是否真的
      // 触发为准——文案含 "aborted" 的网络超时必须亮出原文。
      if (isUserInterrupt(aborter?.signal)) {
        console.log(paint.yellow('  已中断'));
      } else {
        console.error(paint.red(`  出错：${message}`));
        console.log(paint.dim('  ⟳ 未完成的回答未写入会话日志（resume 后不可见）'));
        turnNotifier.error(requestStartedAt, message);
      }
    } finally {
      streaming = false;
      // Long turns end while the user is elsewhere — same cue as the TUI.
      turnNotifier.done(requestStartedAt);
      console.log();
    }
    await maybeAutoCompact();
  }

  rl.close();
  // Kill background jobs before the process exits, or the spawned shells
  // outlive the session (dsh jobs dispose contract).
  await jobs.dispose().catch(() => undefined);
}
