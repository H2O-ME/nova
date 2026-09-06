import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { styledWidth } from '@nova-agent/tui';
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  DEFAULT_MAX_TURNS,
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
  PermissionService,
  PluginHost,
  skillsPlugin,
  type ApprovalMode,
  type AskFn,
} from '@nova-agent/plugins';
import type { McpPlugin } from '@nova-agent/mcp';
import { NOVA_DIR, novaHome, sessionDateBucket, sessionsRoot, type Config } from './config.js';
import { collectProjectDocs, writeAgentsMd } from './agents-md.js';
import { compactSession } from './compact.js';
import { COMMAND_SPECS, createModelListCache } from './commands.js';
import { buildContextFragment, declaredShell, expandSkillInvocation, type SessionEnvInfo } from './context.js';
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
  Spinner,
  statusLine,
  toolDoneLine,
  toolLabel,
  toolStartLine,
} from './ui.js';

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
class LineSource {
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
  for (const plugin of builtinPlugins({
    bash:
      bashConfig?.enabled === false
        ? false
        : {
            ...(bashConfig?.timeoutMs !== undefined ? { timeoutMs: bashConfig.timeoutMs } : {}),
            ...(bashConfig?.shellPath !== undefined ? { shellPath: bashConfig.shellPath } : {}),
          },
  })) {
    host.use(plugin);
  }

  const skills = await loadSkills([
    { dir: path.join(rootDir, NOVA_DIR, 'skills'), level: 'project' },
    { dir: path.join(os.homedir(), '.nova', 'skills'), level: 'user' },
  ]);
  if (skills.length > 0) host.use(skillsPlugin(skills));

  let mcp: McpPlugin | undefined;
  try {
    // Dynamic import: with no mcp.json neither the module nor any connector
    // ever loads; with servers, connection defers to the first agent turn.
    const { loadMcpConfig, mcpPlugin } = await import('@nova-agent/mcp');
    const mcpConfig = await loadMcpConfig(rootDir);
    if (mcpConfig !== undefined && mcpConfig.servers.length > 0) {
      mcp = mcpPlugin({ servers: mcpConfig.servers });
    }
  } catch (err) {
    console.error(`MCP 配置加载失败：${err instanceof Error ? err.message : String(err)}`);
  }
  await host.activate();

  /** MCP connects on demand at the first turn; failed servers retry per turn. */
  let mcpAttached = false;
  const ensureMcp = async (): Promise<void> => {
    if (mcp === undefined) return;
    if (!mcpAttached) {
      mcpAttached = true;
      host.use(mcp);
      await host.activate();
      return;
    }
    await mcp.ensureConnected();
  };

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
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = new LineSource(rl, process.stdin.isTTY === true);
  const spinner = new Spinner(useColor);
  let aborter: AbortController | undefined;
  let streaming = false;

  rl.on('SIGINT', () => {
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
    const argsPreview = call.rawArgs.length > 160 ? `${call.rawArgs.slice(0, 160)}…` : call.rawArgs;
    notify('需要审批', `${toolLabel(call.name)} · ${argsPreview.slice(0, 80)}`);
    const raw = await lines.next(
      paint.yellow(`允许${permissionLabel(kind)} · ${toolLabel(call.name)} ${argsPreview} [y] 本次允许 / [a] 总是允许 / [n] 拒绝：`),
    );
    if (raw === null) return 'deny';
    const answer = raw.trim().toLowerCase();
    if (answer.startsWith('a')) return 'always';
    if (answer.startsWith('y')) return 'allow';
    return 'deny';
  };
  const permission = new PermissionService(approvalMode, askApproval, (entry) => {
    // Log-only approval audit trail; survives resume via the session log.
    void session
      .appendEvent({ type: 'approval', toolName: entry.toolName, kind: entry.kind, outcome: entry.outcome, at: Date.now() })
      .catch(() => {});
  });
  const hooks = host.agentHooks(permission);
  const systemPrompt = buildSystemPrompt();
  let toolStartAt = 0;
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
        toolStartAt = Date.now();
        progressTail = '';
        console.log(toolStartLine(paint, event.call.name, event.call.rawArgs));
        break;
      }
      case 'tool_call_result': {
        const duration = Math.max(0, toolStartAt === 0 ? 0 : Date.now() - toolStartAt);
        toolStartAt = 0;
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
          console.log(
            paint.dim(`  已达 maxTurns 上限（当前 ${config.maxTurns ?? DEFAULT_MAX_TURNS}，可在 .nova/config.json 调大后 /resume 继续）`),
          );
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
        case '/mcp': {
          if (mcp === undefined) {
            console.log('未配置 MCP 服务器（.nova/mcp.json）');
            break;
          }
          const statuses = mcp.status();
          if (statuses.length === 0) {
            console.log('MCP 将在首次对话时按需连接');
            break;
          }
          for (const s of statuses) {
            console.log(`  ${s.server} · ${s.type} · ${s.ok ? `${s.tools} 个工具` : `启动失败：${s.error}`}`);
          }
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
      // Lazy MCP: connect (or retry failed servers) before the first request.
      await ensureMcp().catch(() => undefined);
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
        if (Date.now() - requestStartedAt >= 5000) notify('任务出错', message.slice(0, 120));
      }
    } finally {
      streaming = false;
      // Long turns end while the user is elsewhere — same cue as the TUI.
      if (Date.now() - requestStartedAt >= 15_000) {
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
  if (mcp !== undefined) await mcp.close().catch(() => undefined);
}
