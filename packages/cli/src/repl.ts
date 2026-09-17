import { createInterface } from 'node:readline/promises';
import { detectCaps } from '@nova-agent/tui';
import { errMessage,
  runAgent,
  Session,
  type AgentEvent,
  type AgentMessage,
  type UsageStats,
} from '@nova-agent/core';
import { type ApprovalMode, type AskFn } from '@nova-agent/plugins';
import { newSessionDir, type Config } from './config.js';
import { writeAgentsMd } from './agents-md.js';
import { compactSession } from './compact.js';
import { COMMAND_SPECS, modeOverviewRows } from './commands.js';
import { resolvePalette } from '@nova-agent/tui-view';
import {
  agentsMdWrittenLine,
  approvalSwitchLine,
  helpRows,
  MODEL_LIST_EMPTY,
  modelListError,
  modelListRows,
  newSessionLine,
  nextApprovalMode,
  openFreshSession,
  pluginReportLines,
  sessionReportLines,
  themeSwitchedMessage,
  themeTarget,
  themeUnknownMessage,
  unknownCommandParts,
  type ThemeName,
} from './command-core.js';
import { expandSkillInvocation } from './context.js';
import { recordSessionWorkspace } from './sessions.js';
import { createNotifier } from './notify.js';
import { createSessionRuntime } from './session-runtime.js';
import {
  classifyTurnFailure,
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
  banner,
  permissionLabel,
  toolArgSummary,
  toolDoneLine,
  toolLabel,
  toolStartLine,
} from '@nova-agent/tui-view';
import {
  agentRunBase,
  approvalEffectPreview,
  approvalNotifyBody,
  approvalPrompt,
  attachHooks,
  createApprovalService,
  createAutoCompact,
  ToolTiming,
} from './runner-shared.js';
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

export async function startRepl(opts: ReplOptions): Promise<void> {
  const { rootDir, config } = opts;
  // 主题解析单源（tui-view.resolvePalette）；/theme 运行中可切换。
  const caps = detectCaps();
  const useColor = caps.color;
  let themeName: ThemeName = opts.theme ?? config.ui?.theme ?? 'dark';
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
    // Nested subagent visibility: ReplProgress's latch (constructed below)
    // binds nested rows to the current parent `subagent` call. The callback
    // only FIRES after the latch exists — nested runs happen mid-turn, long
    // after, and no-op while the latch is unpinned.
    subagentProgress: (p) => prog.onSubagentProgress(p),
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
  // 瞬态进度渲染（推理尾行 / bash 尾行 / 子代理暗行 / spinner 生命周期）出壳单主。
  const prog = new ReplProgress({
    paint: () => paint,
    useColor,
    spinner,
    write: (chunk) => process.stdout.write(chunk),
    writeln: (line) => console.log(line),
    cols: () => process.stdout.columns ?? 80,
  });
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

  // 事件呈现委派 ReplProgress（瞬态行）+ bookkeeping（落账），这里只剩
  // 一次性行的 console.log 与计时接线。
  const renderEvent = async (event: AgentEvent, requestStartedAt: number): Promise<void> => {
    switch (event.type) {
      case 'turn_start': {
        prog.startTurn();
        break;
      }
      case 'text_delta': {
        prog.onText(event.text);
        break;
      }
      case 'reasoning_delta': {
        prog.onReasoning(event.text);
        break;
      }
      case 'llm_retry': {
        // Already-streamed text cannot be un-printed here; the notice marks
        // the boundary before the retry replays the answer from scratch.
        Object.assign(stats, event.stats);
        prog.beforeRow();
        console.log(paint.dim(`  ⟳ ${llmRetryNotice(event.error, event.attempt, event.maxRetries)}`));
        break;
      }
      case 'empty_completion': {
        prog.beforeRow();
        console.log(
          paint.dim(`  ⟳ ${emptyCompletionNotice(event.finishReason, event.attempt, event.maxRetries)}`),
        );
        break;
      }
      case 'message': {
        prog.beforeRow();
        if (event.message.content.length > 0) process.stdout.write('\n');
        await bookkeeping.apply(event);
        break;
      }
      case 'tool_call_start': {
        prog.onToolCallStart(event.call.name, event.call.id);
        toolTiming.start(event.call.id);
        console.log(toolStartLine(paint, event.call.name, event.call.rawArgs));
        break;
      }
      case 'tool_call_result': {
        const duration = toolTiming.finish(event.call.id);
        prog.onToolCallEnd();
        await bookkeeping.apply(event);
        for (const line of toolDoneLine(paint, event.call.name, event.call.rawArgs, event.result.content, duration)) {
          console.log(line);
        }
        spinner.start();
        break;
      }
      case 'usage':
      case 'turn_aborted': {
        await bookkeeping.apply(event);
        break;
      }
      case 'done': {
        prog.endTurn();
        for (const line of turnStopLines(paint, event.stopReason, stats, Date.now() - requestStartedAt, config)) {
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
          console.log(helpRows(COMMAND_SPECS).join('\n'));
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
          console.log(newSessionLine(session.file));
          break;
        }
        case '/session': {
          for (const row of sessionReportLines({
            file: session.file,
            messageCount: messages.length,
            stats,
            lastUsage: anchors.lastUsage,
            lastPromptTokens: anchors.lastPromptTokens,
            autoCompactTokenLimit: config.autoCompactTokenLimit,
          })) console.log(row);
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
            for (const row of modelListRows(client.model, models)) console.log(row);
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
          const target = themeTarget(arg);
          if (target === undefined) {
            console.log(themeUnknownMessage(arg));
            break;
          }
          themeName = target;
          paint = resolvePalette(target, caps);
          console.log(themeSwitchedMessage(target));
          break;
        }
        case '/plugins': {
          const rows = pluginReportLines({
            approvalMode: permission.approvalMode,
            override: opts.approvalOverride !== undefined,
            tools: host.toolEntries.map((entry) => ({
              plugin: entry.plugin,
              name: entry.tool.name,
              permission: permissionLabel(entry.permission),
            })),
            commands: host.commandEntries.map((entry) => ({
              plugin: entry.plugin,
              name: entry.command.name,
              description: entry.command.description,
            })),
          });
          for (const row of rows) console.log(row);
          break;
        }
        case '/approvals': {
          const next = nextApprovalMode(permission.approvalMode);
          permission.setMode(next);
          console.log(approvalSwitchLine(next));
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
          console.log(agentsMdWrittenLine(file));
          break;
        }
        default: {
          const unknown = unknownCommandParts(cmd);
          console.log(`${unknown.head}${unknown.hint}`);
        }
      }
      continue;
    }

    await commitUserMessage(session, messages, input);
    await maybePreCompact();

    aborter = new AbortController();
    streaming = true;
    prog.resetReasoning();
    const requestStartedAt = Date.now();
    try {
      for await (const event of runAgent({
        ...agentRun(),
        // Live bash output tail on one in-place dim row (ReplProgress: same
        // single-row contract as the reasoning line).
        onToolProgress: (text) => prog.onToolProgress(text),
        signal: aborter.signal,
      })) {
        await renderEvent(event, requestStartedAt);
      }
    } catch (err) {
      prog.onAbort();
      // 修日志+归类单源（runner-loop.classifyTurnFailure）：以本轮 signal
      // 是否真的触发为准——文案含 "aborted" 的网络超时必须亮出原文。
      const fail = await classifyTurnFailure(session, messages, err, aborter?.signal);
      if (fail.kind === 'interrupt') {
        console.log(paint.yellow('  已中断'));
      } else {
        console.error(paint.red(`  出错：${fail.message}`));
        console.log(paint.dim('  ⟳ 未完成的回答未写入会话日志（resume 后不可见）'));
        turnNotifier.error(requestStartedAt, fail.message);
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
