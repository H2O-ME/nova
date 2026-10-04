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
import { type AgentSurfaceCommandResult, type AgentSurfaceUi } from '@nova-agent/core';
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
} from './command-core.js';
import { mergedCommandSpecs } from './commands.js';
import { permissionLabel } from './lines.js';

/**
 * What the runner needs beyond the surface: the kernel, the two host-side
 * handles (`/model` needs the provider; `/session` / `/plugins` read config),
 * the cached catalog — and the surface's own PRESENTATION half, which is core's
 * `AgentSurfaceUi` and nothing else.
 *
 * This used to be a parallel interface re-declaring the Ui members
 * (`note` / `clear` / `theme` / `pickModel` / `bindSession` / `exit`) beside
 * it — the audit's "hand-copied second shape". Now there is ONE presentation
 * contract: the runner speaks `AgentSurfaceUi`, every surface implements it.
 */
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
  /** The catalog, cached per shell. */
  fetchModels(): Promise<string[]>;
  /** The surface's presentation half (core's contract). */
  ui: AgentSurfaceUi;
}

/** `'handled'` = consumed; `'exit'` = shut the surface down; `{prompt}` = send it. */
export type CommandResult = AgentSurfaceCommandResult;

export async function runAgentCommand(input: string, ports: CommandPorts): Promise<CommandResult> {
  const [cmd = ''] = input.split(/\s+/);
  switch (cmd) {
    case '/exit':
    case '/quit':
      await ports.ui.exit();
      return 'exit';
    case '/help':
      ports.ui.note(helpRows(mergedCommandSpecs(ports.kernel.commands)).join('\n'));
      return 'handled';
    case '/new':
      return newSession(ports);
    case '/session':
      ports.ui.note(
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
      ports.ui.note(
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
      ports.ui.note(approvalSwitchLine(next));
      return 'handled';
    }
    case '/clear':
      ports.ui.clear();
      return 'handled';
    case '/init':
      ports.ui.note(agentsMdWrittenLine(await writeAgentsMd(ports.kernel.rootDir())));
      return 'handled';
    case '/skill':
      return skill(input, ports);
    default: {
      // 命令目录的注册命令（/goal 与一切第三方 /registerCommand）归 kernel
      // runner：壳侧不认识的 /name 先查活目录，有则原样交棒——壳特判一份
      // 语义就会漂移（/compact 曾两边各写一份，守卫与文案各自演化）。
      const name = cmd.slice(1);
      if (ports.kernel.commands.some((entry) => entry.name === name)) {
        await ports.kernel.runCommand(name, input.slice(cmd.length).trim());
        return 'handled';
      }
      const unknown = unknownCommandParts(cmd);
      ports.ui.note(`${unknown.head}${unknown.hint}`, 'warn');
      return 'handled';
    }
  }
}

/**
 * `/mode` is NOT here: the execution mode is the PTC plugin's own vocabulary,
 * so the command that explains it is registered by that plugin and travels with
 * its row (`registerCommand`). The host used to own it — a `codeModeInForce()`
 * that looked the plugin up by name plus a copy of the three mode labels in
 * `lines.ts` — which meant the host had to be edited every time a plugin's
 * vocabulary changed. There is nothing left to keep in sync: this file never
 * learns what a code mode is.
 */

/** `/new`: the kernel builds the log and re-points current; the shell follows. */
async function newSession(ports: CommandPorts): Promise<CommandResult> {
  // The kernel's sessions service re-points current AND re-binds the provider
  // affinity; the shell only follows with its own rendering state.
  const next = await ports.kernel.newAgentSession();
  ports.ui.bindSession(next);
  ports.ui.note(newSessionLine(next.session.file));
  return 'handled';
}

async function pickModel(ports: CommandPorts): Promise<void> {
  try {
    const models = await ports.fetchModels();
    if (models.length === 0) {
      ports.ui.note(MODEL_LIST_EMPTY);
      return;
    }
    const chosen = await ports.ui.pickModel(models);
    if (chosen === undefined) {
      ports.ui.note('已取消');
      return;
    }
    if (chosen === ports.client.model) {
      ports.ui.note(`已是当前模型：${chosen}`);
      return;
    }
    ports.client.setModel(chosen);
    ports.ui.note(`模型已切换为 ${chosen}`);
  } catch (err) {
    ports.ui.note(modelListError(err), 'warn');
  }
}

function switchTheme(input: string, ports: CommandPorts): void {
  const arg = input.trim().split(/\s+/)[1];
  if (arg === undefined) {
    ports.ui.note(`当前主题：${ports.ui.theme()}（/theme dark|light|plain 切换；NO_COLOR 恒定无色）`);
    return;
  }
  const target = themeTarget(arg);
  if (target === undefined) {
    ports.ui.note(themeUnknownMessage(arg), 'warn');
    return;
  }
  ports.ui.setTheme(target);
  ports.ui.note(themeSwitchedMessage(target));
}

/** `/skill <name>` expands into the prompt that loads the skill body. */
async function skill(input: string, ports: CommandPorts): Promise<CommandResult> {
  const invocation = await expandSkillInvocation(input, ports.kernel.skills);
  if (invocation === undefined) return 'handled'; // not a skill invocation at all
  if (!invocation.ok) {
    ports.ui.note(invocation.error, 'warn');
    return 'handled';
  }
  return { prompt: invocation.content };
}