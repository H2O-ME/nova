/**
 * One command runner, two shells (M11 批5).
 *
 * The slash commands were written twice — once per shell — and the copies had
 * already drifted: repl's `/skill <name>` answered "未知命令" (the skill
 * expansion ran only for non-slash input) while the other shell loaded the skill.
 * This file owns the part that must not differ: what a command does to the
 * kernel (new session, approvals, mode, compact), how its arguments are
 * parsed (theme names, skill names) and what it reports (the `command-core`
 * builders). What a shell still owns is presentation — the runner hands it a
 * `note` line, a model picker of its own shape (numbered prompt vs panel) and
 * a `clear` of its own kind (console vs transcript).
 */
import { errMessage, type AgentSession } from '@nova-agent/core';
import { writeAgentsMd, type ApprovalMode, type Kernel } from '@nova-agent/plugins';
import type { Config } from './config.js';
import {
  agentsMdWrittenLine,
  approvalSwitchLine,
  expandSkillInvocation,
  helpRows,
  MODEL_LIST_EMPTY,
  modelListError,
  newSessionLine,
  nextApprovalMode,
  pluginReportLines,
  sessionReportLines,
  themeSwitchedMessage,
  themeTarget,
  themeUnknownMessage,
  unknownCommandParts,
  type ThemeName,
} from './command-core.js';
import { COMMAND_SPECS, modeOverviewRows } from './commands.js';
import { codeModeLabel, permissionLabel } from './lines.js';

export interface CommandPorts {
  kernel: Kernel;
  /**
   * Provider handle for `/model`. Session affinity is NOT here: the kernel's
   * `llm` service binds it when a session becomes current, so no shell can
   * forget to.
   */
  client: {
    readonly model: string;
    setModel(model: string): void;
  };
  config: Config;
  approvalOverride: ApprovalMode | undefined;
  /** The live theme name (`/theme` with no argument reports it). */
  theme(): ThemeName;
  setTheme(theme: ThemeName): void;
  /** One line for the surface: stdout, or a note in the transcript. */
  note(text: string, tone?: 'info' | 'warn'): void;
  /** The catalog, cached per shell. */
  fetchModels(): Promise<string[]>;
  /** The shell's own picker: the chosen model, or undefined when cancelled. */
  pickModel(models: readonly string[]): Promise<string | undefined>;
  /** Follow a NEW session handle (subscriptions, panels, affinity). */
  bindSession(agent: AgentSession): void;
  /** The shell's own clear: `console.clear()` or an empty transcript. */
  clear(): void;
  /** How THIS shell switches modes, appended to the `/mode` header. */
  modeHint: string;
  exit(): void | Promise<void>;
}

/**
 * `'handled'` = consumed; `'exit'` = shut the shell down; `{prompt}` = the
 * text the shell should send to the model (`/skill` expands into one).
 */
export type CommandResult = 'handled' | 'exit' | { prompt: string };

export async function runAgentCommand(input: string, ports: CommandPorts): Promise<CommandResult> {
  const [cmd = ''] = input.split(/\s+/);
  switch (cmd) {
    case '/exit':
    case '/quit':
      await ports.exit();
      return 'exit';
    case '/help':
      ports.note(helpRows(COMMAND_SPECS).join('\n'));
      return 'handled';
    case '/new':
      return newSession(ports);
    case '/session':
      ports.note(
        sessionReportLines({
          file: ports.kernel.agent.session.file,
          messageCount: ports.kernel.agent.messages.length,
          stats: ports.kernel.agent.usageSnapshot(),
          lastUsage: ports.kernel.agent.lastUsage,
          lastPromptTokens: ports.kernel.agent.lastPromptTokens,
          autoCompactTokenLimit: ports.config.autoCompactTokenLimit,
        }).join('\n'),
      );
      return 'handled';
    case '/model':
      await pickModel(ports);
      return 'handled';
    case '/theme':
      switchTheme(input, ports);
      return 'handled';
    case '/plugins':
      ports.note(
        pluginReportLines({
          approvalMode: ports.kernel.permission.approvalMode,
          override: ports.approvalOverride !== undefined,
          tools: ports.kernel.host.toolEntries.map((entry) => ({
            plugin: entry.plugin,
            name: entry.tool.name,
            permission: permissionLabel(entry.permission),
          })),
          commands: ports.kernel.host.commandEntries.map((entry) => ({
            plugin: entry.plugin,
            name: entry.command.name,
            description: entry.command.description,
          })),
          roster: ports.kernel.roster(),
        }).join('\n'),
      );
      return 'handled';
    case '/approvals': {
      const next = nextApprovalMode(ports.kernel.permission.approvalMode);
      ports.kernel.permission.setMode(next);
      ports.note(approvalSwitchLine(next));
      return 'handled';
    }
    case '/mode': {
      const mode = ports.kernel.codeMode();
      ports.note(
        [
          `执行模式：${codeModeLabel(mode)}${ports.modeHint}`,
          ...modeOverviewRows(mode).map((row) => `  ${row.text}`),
        ].join('\n'),
      );
      return 'handled';
    }
    case '/compact':
      await compact(ports);
      return 'handled';
    case '/clear':
      ports.clear();
      return 'handled';
    case '/init':
      ports.note(agentsMdWrittenLine(await writeAgentsMd(ports.kernel.rootDir())));
      return 'handled';
    case '/skill':
      return skill(input, ports);
    default: {
      const unknown = unknownCommandParts(cmd);
      ports.note(`${unknown.head}${unknown.hint}`, 'warn');
      return 'handled';
    }
  }
}

/** `/new`: the kernel builds the log and re-points current; the shell follows. */
async function newSession(ports: CommandPorts): Promise<CommandResult> {
  // The kernel's sessions service re-points current AND re-binds the provider
  // affinity; the shell only follows with its own rendering state.
  const next = await ports.kernel.newAgentSession();
  ports.bindSession(next);
  ports.note(newSessionLine(next.session.file));
  return 'handled';
}

async function pickModel(ports: CommandPorts): Promise<void> {
  try {
    const models = await ports.fetchModels();
    if (models.length === 0) {
      ports.note(MODEL_LIST_EMPTY);
      return;
    }
    const chosen = await ports.pickModel(models);
    if (chosen === undefined) {
      ports.note('已取消');
      return;
    }
    if (chosen === ports.client.model) {
      ports.note(`已是当前模型：${chosen}`);
      return;
    }
    ports.client.setModel(chosen);
    ports.note(`模型已切换为 ${chosen}`);
  } catch (err) {
    ports.note(modelListError(err), 'warn');
  }
}

function switchTheme(input: string, ports: CommandPorts): void {
  const arg = input.trim().split(/\s+/)[1];
  if (arg === undefined) {
    ports.note(`当前主题：${ports.theme()}（/theme dark|light|plain 切换；NO_COLOR 恒定无色）`);
    return;
  }
  const target = themeTarget(arg);
  if (target === undefined) {
    ports.note(themeUnknownMessage(arg), 'warn');
    return;
  }
  ports.setTheme(target);
  ports.note(themeSwitchedMessage(target));
}

async function compact(ports: CommandPorts): Promise<void> {
  if (ports.kernel.agent.running) {
    ports.note('本轮进行中，压缩会在轮结束后自动把关（或稍后再试）', 'warn');
    return;
  }
  ports.note('正在压缩会话…');
  try {
    const outcome = await ports.kernel.agent.compact('manual');
    ports.note(`已压缩 — 会话原位压缩（日志保留完整历史），摘要 ${outcome.summary.length} 字，保留 ${outcome.retained} 条最近用户消息`);
  } catch (err) {
    ports.note(`压缩失败：${errMessage(err)}`, 'warn');
  }
}

/** `/skill <name>` expands into the prompt that loads the skill body. */
async function skill(input: string, ports: CommandPorts): Promise<CommandResult> {
  const invocation = await expandSkillInvocation(input, ports.kernel.skills);
  if (invocation === undefined) return 'handled'; // not a skill invocation at all
  if (!invocation.ok) {
    ports.note(invocation.error, 'warn');
    return 'handled';
  }
  return { prompt: invocation.content };
}