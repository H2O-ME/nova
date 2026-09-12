import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { styledWidth } from '@nova-agent/tui';
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  emptyStats,
  estimateNextPromptTokens,
  JobRegistry,
  newId,
  runAgent,
  Session,
  type AgentEvent,
  type AgentMessage,
  type Usage,
  type UsageStats,
  type UserMessage,
} from '@nova-agent/core';
import {
  builtinPlugins,
  loadSkills,
  PluginHost,
  skillsPlugin,
  type ApprovalMode,
  type AskFn,
} from '@nova-agent/plugins';
import { NOVA_DIR, novaHome, sessionDateBucket, sessionsRoot, type Config } from './config.js';
import { collectProjectDocs, writeAgentsMd } from './agents-md.js';
import { compactSession } from './compact.js';
import { COMMAND_SPECS, createModelListCache } from './commands.js';
import { buildContextFragment, declaredShell, expandSkillInvocation, type SessionEnvInfo } from './context.js';
import { recordSessionWorkspace } from './sessions.js';
import { createNotifier } from './notify.js';
import { buildSystemPrompt } from './system-prompt.js';
import {
  approvalLabel,
  APPROVAL_ORDER,
  banner,
  fitTail,
  palette,
  permissionLabel,
  plainPalette,
  statusLine,
  toolDoneLine,
  toolLabel,
  toolStartLine,
} from './ui.js';
import {
  approvalPrompt,
  createApprovalService,
  LONG_TASK,
  maxTurnsHint,
  ToolTiming,
} from './runner-shared.js';
import { Spinner } from './spinner.js';
import { cliVersion } from './version.js';

export interface ReplOptions {
  rootDir: string;
  config: Config;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
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
  const useColor = process.stdout.isTTY === true;
  const paint = useColor ? palette : plainPalette;

  // 会话按日期归档（codex 式）：~/.nova/sessions/YYYY/MM/DD/，工作区零写入。
  const newSessionDir = (): string => path.join(sessionsRoot(), sessionDateBucket());
  let sessionsDir = newSessionDir();
  let messages: AgentMessage[] = [];
  let session: Session;
  if (opts.resumeFile) {
    session = await Session.open(opts.resumeFile);
    messages = session.deriveMessages();
    console.log(`resumed ${messages.length} messages from ${session.file}`);
    for (const warning of session.warnings) console.log(paint.yellow(`  ${warning}`));
  } else {
    session = await Session.create(sessionsDir);
    await recordSessionWorkspace(session, rootDir);
  }

  const client = new OpenAICompatClient({
    baseURL: config.provider.baseURL,
    apiKey: config.provider.apiKey,
    model: config.provider.model,
    sessionId: session.id,
    ...(config.provider.temperature !== undefined ? { temperature: config.provider.temperature } : {}),
    ...(config.provider.maxTokens !== undefined ? { maxTokens: config.provider.maxTokens } : {}),
  });
  /** 站点模型目录（GET /models），/model 用；60s 缓存避免连续操作反复请求。 */
  const fetchModelList = createModelListCache(() => client.listModels());
  const stats: UsageStats = emptyStats();
  const jobs = new JobRegistry();

  const approvalMode = opts.approvalOverride ?? config.approval ?? 'read-only';
  const host = new PluginHost(rootDir);
  const bashConfig = config.tools?.bash;
  const codeConfig = config.tools?.code;
  for (const plugin of builtinPlugins({
    spillReadRoot: path.join(novaHome(), 'cache', 'tool-outputs'),
    bash:
      bashConfig?.enabled === false
        ? false
        : {
            ...(bashConfig?.timeoutMs !== undefined ? { timeoutMs: bashConfig.timeoutMs } : {}),
            ...(bashConfig?.shellPath !== undefined ? { shellPath: bashConfig.shellPath } : {}),
          },
    ...(codeConfig !== undefined ? { code: codeConfig } : {}),
  })) {
    host.use(plugin);
  }

  const skills = await loadSkills([
    { dir: path.join(rootDir, NOVA_DIR, 'skills'), level: 'project' },
    { dir: path.join(os.homedir(), '.nova', 'skills'), level: 'user' },
  ]);
  if (skills.length > 0) host.use(skillsPlugin(skills));
  await host.activate();

  const sessionEnv: SessionEnvInfo = {
    platform: process.platform,
    cwd: rootDir,
    // Must match the shell the bash tool really runs (invocation() resolution).
    shell: declaredShell(bashConfig?.shellPath),
    today: new Date().toISOString().slice(0, 10),
  };
  // AGENTS.md chain is session-stable by design; /init results land in the next session.
  const projectDocs = await collectProjectDocs(rootDir, process.cwd());
  const buildFragment = (): string => buildContextFragment(sessionEnv, config.systemPrompt, skills, projectDocs);
  /** Re-seed the context fragment when a fresh session starts (/new). */
  const seedContextFragment = async (): Promise<void> => {
    const seed: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: buildFragment() };
    messages.push(seed);
    await session.append(seed);
  };
  if (!opts.resumeFile) await seedContextFragment();

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
    const entry = host.toolEntries.find((e) => e.tool.name === call.name);
    if (entry !== undefined && entry.tool.preview !== undefined) {
      try {
        const preview = (await entry.tool.preview(call.args, { rootDir })).trim();
        if (preview.length > 0) {
          for (const line of preview.split('\n')) console.log(paint.dim(`  ${line}`));
        }
      } catch {
        // Preview is a nicety; a failing one must not block the approval flow.
      }
    }
    const argsPreview = call.rawArgs.length > 160 ? `${call.rawArgs.slice(0, 160)}…` : call.rawArgs;
    const { prompt, alwaysScopeNote } = approvalPrompt(
      permissionLabel(kind),
      toolLabel(call.name),
      argsPreview,
      kind,
    );
    notify('需要审批', `${toolLabel(call.name)} · ${argsPreview.slice(0, 80)}`);
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
  const permission = createApprovalService(approvalMode, askApproval, session);
  const hooks = host.agentHooks(permission);
  const systemPrompt = buildSystemPrompt();
  const toolTiming = new ToolTiming();
  let lastUsage: Usage | undefined;
  let lastPromptTokens = 0;
  // Usage anchor for pre-flight token estimates (see maybePreCompact).
  let usageAnchor: Usage | undefined;
  let anchorMsgCount = 0;
  let compactRunning = false;
  let reasoningTail = '';
  let reasoningLive = false;
  let progressTail = '';
  let progressLive = false;
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

  /** Shared in-place compaction used by /compact, the auto threshold and the pre-flight check. */
  const runCompact = async (trigger: 'auto' | 'manual') => {
    compactRunning = true;
    try {
      const outcome = await compactSession({ client, session, messages, trigger });
      messages = outcome.surface;
      Object.assign(stats, emptyStats());
      lastUsage = undefined;
      lastPromptTokens = 0;
      usageAnchor = undefined;
      anchorMsgCount = 0;
      return outcome;
    } finally {
      compactRunning = false;
    }
  };

  /** Pre-flight check: compact BEFORE the next request when the anchor-based projection exceeds the limit. */
  const maybePreCompact = async (): Promise<void> => {
    const limit = config.autoCompactTokenLimit;
    if (limit === undefined || compactRunning || usageAnchor === undefined) return;
    const estimate = estimateNextPromptTokens(usageAnchor, messages.slice(anchorMsgCount));
    if (estimate <= limit) return;
    console.log(paint.yellow(`预估下轮 ${estimate} tok 超过阈值 ${limit}，提前压缩…`));
    try {
      const outcome = await runCompact('auto');
      console.log(`已自动压缩 — 会话原位压缩（日志保留完整历史），保留 ${outcome.retained} 条最近用户消息`);
    } catch (err) {
      console.error(paint.red(`自动压缩失败：${err instanceof Error ? err.message : String(err)}`));
    }
  };

  /** Fallback: auto-compact AFTER a turn when its prompt tokens exceeded the threshold. */
  const maybeAutoCompact = async (): Promise<void> => {
    const limit = config.autoCompactTokenLimit;
    if (limit === undefined || compactRunning || lastPromptTokens <= limit) return;
    console.log(paint.yellow(`上下文约 ${lastPromptTokens} tok，超过自动压缩阈值 ${limit}，正在压缩…`));
    try {
      const outcome = await runCompact('auto');
      console.log(`已自动压缩 — 会话原位压缩（日志保留完整历史），保留 ${outcome.retained} 条最近用户消息`);
    } catch (err) {
      console.error(paint.red(`自动压缩失败：${err instanceof Error ? err.message : String(err)}`));
    }
  };

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
        console.log(paint.dim(`  ⟳ 上游流中断（${event.error}），自动重试 ${event.attempt}/${event.maxRetries}…`));
        break;
      }
      case 'message': {
        endReasoningLine();
        spinner.stop();
        if (event.message.content.length > 0) process.stdout.write('\n');
        await session.append(event.message);
        break;
      }
      case 'tool_call_start': {
        endReasoningLine();
        spinner.stop();
        toolTiming.start(event.call.id);
        progressTail = '';
        console.log(toolStartLine(paint, event.call.name, event.call.rawArgs));
        break;
      }
      case 'tool_call_result': {
        const duration = toolTiming.finish(event.call.id);
        clearProgressLine();
        await session.append(event.result);
        for (const line of toolDoneLine(paint, event.call.name, event.call.rawArgs, event.result.content, duration)) {
          console.log(line);
        }
        spinner.start();
        break;
      }
      case 'usage': {
        Object.assign(stats, event.stats);
        lastUsage = event.usage;
        lastPromptTokens = event.usage.promptTokens;
        usageAnchor = event.usage;
        anchorMsgCount = messages.length;
        break;
      }
      case 'turn_aborted': {
        await session.append(event.message);
        break;
      }
      case 'done': {
        endReasoningLine();
        clearProgressLine();
        spinner.stop();
        const kind = event.stopReason;
        console.log(statusLine(paint, kind === 'complete' ? 'complete' : kind, stats, Date.now() - requestStartedAt));
        if (kind === 'max_turns') {
          console.log(paint.dim(maxTurnsHint(config)));
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
          session = await Session.create(sessionsDir);
          await recordSessionWorkspace(session, rootDir);
          // Rebind the cache-affinity identity and drop the old usage anchor:
          // keeping either would send the old session's cache key (or trigger
          // a spurious compaction) in the fresh session.
          client.setSessionId(session.id);
          messages = [];
          Object.assign(stats, emptyStats());
          lastUsage = undefined;
          lastPromptTokens = 0;
          usageAnchor = undefined;
          anchorMsgCount = 0;
          await seedContextFragment();
          console.log(`新会话：${session.file}`);
          break;
        }
        case '/session': {
          const hit =
            stats.promptTokens > 0
              ? ((stats.cachedTokens / stats.promptTokens) * 100).toFixed(1)
              : '0.0';
          const lastHit =
            lastUsage !== undefined && lastUsage.promptTokens > 0
              ? Math.round((lastUsage.cachedTokens / lastUsage.promptTokens) * 100)
              : null;
          const compact = config.autoCompactTokenLimit
            ? `阈值 ${config.autoCompactTokenLimit} tok · 上轮 ${lastPromptTokens} tok`
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
              console.log('站点未返回任何模型');
              break;
            }
            console.log(`当前模型：${client.model}`);
            for (const [i, model] of models.entries()) {
              console.log(`  ${model === client.model ? '❯' : ' '} ${i + 1}. ${model}${model === client.model ? '（当前）' : ''}`);
            }
            const raw = await lines.next(paint.cyan('输入序号切换模型，回车取消：'));
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
            console.log(`模型列表获取失败：${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        case '/plugins': {
          console.log(`审批档位：${approvalLabel(permission.approvalMode)}${opts.approvalOverride !== undefined ? '（来自 --approval）' : ''}`);
          if (host.toolEntries.length === 0) console.log('（没有已注册的工具）');
          for (const entry of host.toolEntries) {
            console.log(`  插件=${entry.plugin} · 工具=${entry.tool.name} · 权限=${permissionLabel(entry.permission)}`);
          }
          for (const entry of host.commandEntries) {
            console.log(`  插件=${entry.plugin} · /${entry.command.name} — ${entry.command.description}`);
          }
          break;
        }
        case '/approvals': {
          const idx = APPROVAL_ORDER.indexOf(permission.approvalMode);
          const next = APPROVAL_ORDER[(idx + 1) % APPROVAL_ORDER.length] ?? 'read-only';
          permission.setMode(next);
          console.log(`审批档位：${approvalLabel(next)}`);
          break;
        }
        case '/compact': {
          console.log('正在压缩会话…');
          try {
            const outcome = await runCompact('manual');
            console.log(
              `已压缩 — 会话原位压缩（日志保留完整历史），摘要 ${outcome.summary.length} 字，保留 ${outcome.retained} 条最近用户消息`,
            );
          } catch (err) {
            console.error(`压缩失败：${err instanceof Error ? err.message : String(err)}`);
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

    const userMsg: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: input };
    messages.push(userMsg);
    await session.append(userMsg);

    await maybePreCompact();

    aborter = new AbortController();
    streaming = true;
    reasoningTail = '';
    const requestStartedAt = Date.now();
    try {
      for await (const event of runAgent({
        provider: client,
        messages,
        rootDir,
        // Spilled tool outputs are grouped per session.
        cacheDir: path.join(novaHome(), 'cache', 'tool-outputs', session.id),
        jobs,
        emit: async (evt) => { await session.appendEvent(evt); },
        tools: host.tools,
        hooks,
        systemPrompt,
        maxTurns: config.maxTurns,
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
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(message))) {
        console.log(paint.yellow('  已中断'));
      } else {
        console.error(paint.red(`  出错：${message}`));
        if (Date.now() - requestStartedAt >= LONG_TASK.errorMs) notify('任务出错', message.slice(0, 120));
      }
    } finally {
      streaming = false;
      // Long turns end while the user is elsewhere — same cue as the TUI.
      if (Date.now() - requestStartedAt >= LONG_TASK.doneMs) {
        notify('任务已完成', `本轮耗时约 ${Math.max(1, Math.round((Date.now() - requestStartedAt) / 60000))} 分钟，回到终端查看结果`);
      }
      console.log();
    }
    await maybeAutoCompact();
  }

  rl.close();
  // Kill background jobs before the process exits, or the spawned shells
  // outlive the session (dsh jobs dispose contract).
  await jobs.dispose().catch(() => undefined);
}
