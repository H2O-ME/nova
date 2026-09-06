import path from 'node:path';
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  emptyStats,
  JobRegistry,
  newId,
  runAgent,
  Session,
  type AgentEvent,
  type AgentMessage,
  type ChatProvider,
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
import { NOVA_DIR, novaHome, sessionDateBucket, sessionsRoot, type Config } from './config.js';
import { buildContextFragment, declaredShell, type SessionEnvInfo } from './context.js';
import { createNotifier } from './notify.js';
import { recordSessionWorkspace } from './sessions.js';
import { buildSystemPrompt } from './system-prompt.js';
import { palette, plainPalette, statusLine, toolDoneLine, toolStartLine } from './ui.js';

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
  const permission = new PermissionService(approvalMode, async () => 'deny');
  // Headless runs cannot ask: 'never' denies every gated call deterministically,
  // inside the service, without dispatching any asker.
  permission.setPolicy('never');
  const hooks = host.agentHooks(permission);
  const systemPrompt = buildSystemPrompt();

  if (!json) write(`${paint.cyan('›')} ${prompt}\n`);
  let toolStartAt = 0;
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
    if (elapsed >= 30_000) {
      notify('任务已完成', `exec 运行约 ${Math.max(1, Math.round(elapsed / 60000))} 分钟，回到终端查看结果`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`出错：${message}`);
    if (Date.now() - execStartedAt >= 30_000) notify('任务出错', message.slice(0, 120));
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
        toolStartAt = Date.now();
        sink(`${toolStartLine(p, event.call.name, event.call.rawArgs)}\n`);
        break;
      case 'tool_call_result': {
        const duration = Math.max(0, toolStartAt === 0 ? 0 : Date.now() - toolStartAt);
        toolStartAt = 0;
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
