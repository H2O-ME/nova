import path from 'node:path';
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  emptyStats,
  estimateMessageTokens,
  JobRegistry,
  newId,
  runAgent,
  Session,
  type AgentEvent,
  type AgentHooks,
  type AgentMessage,
  type ChatProvider,
  type ChatRequest,
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
} from '@nova-agent/plugins';
import { collectProjectDocs } from './agents-md.js';
import { compactSession } from './compact.js';
import { NOVA_DIR, novaHome, sessionDateBucket, sessionsRoot, type Config } from './config.js';
import { buildContextFragment, declaredShell, type SessionEnvInfo } from './context.js';
import { createNotifier } from './notify.js';
import { recordSessionWorkspace } from './sessions.js';
import { buildSystemPrompt } from './system-prompt.js';
import { palette, plainPalette, statusLine, toolDoneLine, toolStartLine } from './ui.js';
import { LONG_TASK, ToolTiming } from './runner-shared.js';

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

  // 会话按日期归档（codex 式）：~/.nova/sessions/YYYY/MM/DD/，工作区零写入。
  const sessionsDir = path.join(sessionsRoot(), sessionDateBucket());
  let messages: AgentMessage[] = [];
  let session: Session;
  if (opts.resumeFile) {
    session = await Session.open(opts.resumeFile);
    messages = session.deriveMessages();
  } else {
    session = await Session.create(sessionsDir);
    await recordSessionWorkspace(session, rootDir);
  }

  const provider = opts.provider ?? new OpenAICompatClient({
    baseURL: config.provider.baseURL,
    apiKey: config.provider.apiKey,
    model: config.provider.model,
    sessionId: session.id,
    ...(config.provider.temperature !== undefined ? { temperature: config.provider.temperature } : {}),
    ...(config.provider.maxTokens !== undefined ? { maxTokens: config.provider.maxTokens } : {}),
  });
  const stats: UsageStats = emptyStats();
  const jobs = new JobRegistry();

  const approvalMode = opts.approvalOverride ?? config.approval ?? 'read-only';
  const host = new PluginHost(rootDir);
  const bashConfig = config.tools?.bash;
  const codeConfig = config.tools?.code;
  const spillReadRoot = path.join(novaHome(), 'cache', 'tool-outputs');
  for (const plugin of builtinPlugins({
    spillReadRoot,
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
    { dir: path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '', '.nova', 'skills'), level: 'user' },
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
  const projectDocs = await collectProjectDocs(rootDir, process.cwd());
  const fragment = buildContextFragment(sessionEnv, config.systemPrompt, skills, projectDocs);
  if (!opts.resumeFile) {
    const seed: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: fragment };
    messages.push(seed);
    await session.append(seed);
  }

  const userMsg: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: prompt };
  messages.push(userMsg);
  await session.append(userMsg);

  // Non-interactive: nobody can answer an approval prompt, so requests are denied.
  // (No audit trail: exec never asks, so no ask-path decisions exist to log.)
  const permission = new PermissionService(approvalMode, async () => 'deny');
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
    compact: async (messages) => {
      const outcome = await compactSession({ client: provider, session, messages, trigger: 'auto' });
      // Apply the new surface IN PLACE: runAgent and the outer `messages`
      // reference the same array object, so a splice keeps every consumer
      // in sync without plumbed return values.
      messages.splice(0, messages.length, ...outcome.surface);
      if (!json) write(`${paint.dim('⟳ 已自动压缩上下文（超过阈值；会话日志保留完整历史）')}\n`);
    },
    onError: (err: unknown) => {
      if (!json) write(`${paint.dim(`⟳ 自动压缩失败（继续运行）：${err instanceof Error ? err.message : String(err)}`)}\n`);
    },
    onWarn: (text: string) => {
      if (!json) write(`${paint.dim(`⟳ ${text}`)}\n`);
    },
  });
  const systemPrompt = buildSystemPrompt();

  if (!json) write(`${paint.cyan('›')} ${prompt}\n`);
  const toolTiming = new ToolTiming();
  // Headless runs are exactly the ones the user walks away from; completion
  // and failure notifications matter most here (30s threshold: short runs
  // finish before the user can even switch windows). Disabled for injected
  // test sinks.
  const notify = createNotifier({ enabled: opts.out === undefined && config.notify !== false });
  const execStartedAt = Date.now();
  try {
    for await (const event of runAgent({
        provider,
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
    })) {
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
    console.error(`出错：${message}`);
    if (Date.now() - execStartedAt >= LONG_TASK.execDoneMs) notify('任务出错', message.slice(0, 120));
    process.exitCode = 1;
  } finally {
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
        sink(`\n${statusLine(p, kind, stats, 0)}\n`);
        break;
      }
      default:
        break;
    }
  }
}

interface AutoCompactOptions {
  enabled: boolean;
  limit: number;
  /** Compact the live surface; the callback splices `messages` in place. */
  compact: (messages: AgentMessage[]) => Promise<void>;
  onError: (err: unknown) => void;
  /** One-shot user-facing line: the fuse tripping or the splice contract breaking. */
  onWarn: (text: string) => void;
}

/** Full outgoing-request image: system prompt + tool schemas + every message. */
function requestImageTokens(next: ChatRequest): number {
  let image = estimateMessageTokens({ role: 'system', id: '', ts: 0, content: next.systemPrompt ?? '' });
  for (const tool of next.tools ?? []) {
    image += estimateMessageTokens({
      role: 'system',
      id: '',
      ts: 0,
      content: `${tool.name} ${tool.description} ${JSON.stringify(tool.parameters)}`,
    });
  }
  for (const msg of next.messages) image += estimateMessageTokens(msg);
  return image;
}

/**
 * Token-gate every outgoing LLM request inside runAgent. The interactive
 * runners compact at user-message boundaries (before/after a run); exec has
 * exactly one run for the whole task, so the per-request hook is the only
 * interception point. The estimate prices the full request image (system +
 * tool schemas + messages, assistant tool-call args included) against the
 * configured limit. Compaction happens in place (the log gets its three
 * compaction events, `messages` becomes the projected surface) — and is
 * FUSED after a compaction that still leaves the image over the limit: the
 * retained floor (system + tool schemas + context fragment + kept recents +
 * fresh summary) is then above the threshold, so repeating the summarizer
 * request every turn would buy nothing while doubling per-turn cost and
 * flooding the session log with compaction triples.
 */
function wrapAutoCompact(hooks: AgentHooks, opts: AutoCompactOptions): void {
  if (!opts.enabled) return;
  const inner = hooks.beforeLLMCall;
  let compacting = false;
  let fused = false;
  hooks.beforeLLMCall = async (req) => {
    const next = inner === undefined ? req : await inner(req);
    if (compacting || fused) return next;
    // In-place compaction contract: the hook chain must hand back the SAME
    // messages array object runAgent passed in, so the splice below reaches
    // the live log. A plugin hook that clones `req.messages` would compact a
    // throwaway copy: the log never shrinks, every turn re-compacts, and the
    // model surface diverges from the projection ("model-visible means
    // logged" broken). Such plugins are a planned extension point, so check
    // explicitly and disarm rather than corrupt.
    if (next.messages !== req.messages) {
      fused = true;
      opts.onWarn('插件钩子替换了消息数组：本次任务的自动压缩已停用（原位压缩会失效）');
      return next;
    }
    if (requestImageTokens(next) <= opts.limit) return next;
    compacting = true;
    try {
      await opts.compact(next.messages);
      const after = requestImageTokens(next);
      if (after > opts.limit) {
        fused = true;
        opts.onWarn(
          `压缩后仍约 ${after} tok 超阈值 ${opts.limit} tok（保留片段+工具 schema 构成下限）：本次任务停用自动压缩，后续请求可能超窗，可考虑调大 autoCompactTokenLimit`,
        );
      }
    } catch (err) {
      opts.onError(err);
    } finally {
      compacting = false;
    }
    return next;
  };
}
