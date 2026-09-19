/**
 * `nova`（M11 批4d）：默认交互形态 = 全屏 TUI（`@nova-agent/tui-app` surface）。
 *
 * 与 repl 的关系是**同内核、两 surface**：装配（provider/config/审批覆盖/
 * jobs 订阅）走同一批小件；命令文案与 /mode /session /plugins 的数据装配复用
 * command-core 的纯函数，只有呈现面不同（TUI 是卡片与面板，repl 打印行）。
 * 非 TTY（管道/CI）由 index.ts 回落 repl，本文件只负责 TUI 形态。
 */
import os from 'node:os';
import { errMessage, type PtcMode } from '@nova-agent/core';
import { createAgentKernel, writeAgentsMd, type ApprovalMode, type Kernel } from '@nova-agent/plugins';
import { detectCaps } from '@nova-agent/tui';
import { TuiApp, buildPalette, type ThemeName } from '@nova-agent/tui-app';
import type { Config } from './config.js';
import { COMMAND_SPECS, createModelListCache, modeOverviewRows } from './commands.js';
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
import { codeModeLabel, permissionLabel } from './lines.js';
import { createProvider, toKernelConfig } from './kernel-boot.js';
import { createModelMetaStore } from './model-meta.js';

export interface TuiModeOptions {
  rootDir: string;
  config: Config;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
  /** --theme 覆盖 config 的 ui.theme。 */
  theme?: ThemeName;
}

interface Deps {
  app: TuiApp;
  kernel: Kernel;
  client: ReturnType<typeof createProvider>;
  config: Config;
  modelCache: () => Promise<string[]>;
  approvalOverride: ApprovalMode | undefined;
  theme: ThemeName;
}

export async function startTui(opts: TuiModeOptions): Promise<void> {
  const { rootDir, config } = opts;
  const client = createProvider(config);
  // The subagent feed and the workspace switch both need the kernel handle, and
  // both fire long after assembly — the holder is what makes that honest.
  const holder: { kernel?: Kernel } = {};
  const kernel = await createAgentKernel({
    rootDir,
    provider: client,
    config: toKernelConfig(config, opts.approvalOverride),
    ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    onSubagentProgress: (progress) => holder.kernel?.agent.observeSubagent(progress),
    workspace: {
      onChange: async (dir: string) => {
        const skills = await kernel.setWorkspace(dir);
        app.note(`工作区已切换：${dir}（技能 ${skills.length} 个）`);
      },
    },
  });
  holder.kernel = kernel;

  const deps: Deps = {
    app: undefined as unknown as TuiApp,
    kernel,
    client,
    config,
    modelCache: createModelListCache(() => client.listModels()),
    approvalOverride: opts.approvalOverride,
    theme: opts.theme ?? config.ui?.theme ?? 'dark',
  };
  const app = new TuiApp({
    agent: kernel.agent,
    tools: () => kernel.host.toolEntries.map((entry) => entry.tool),
    rootDir: kernel.rootDir(),
    homeDir: os.homedir(),
    skills: kernel.skills.length,
    model: client.model,
    codeMode: kernel.codeMode(),
    commands: COMMAND_SPECS,
    // The gauge needs a denominator, but never at the price of a blank terminal:
    // the config value lands now and models.dev fills in the rest when it
    // arrives (a cold cache is a network round trip).
    ...(config.provider.contextWindow !== undefined ? { contextWindow: config.provider.contextWindow } : {}),
    ...(config.autoCompactTokenLimit !== undefined ? { autoCompactTokenLimit: config.autoCompactTokenLimit } : {}),
    onCommand: (text) => runCommand(text, deps),
    onCycleMode: () => cycleMode(deps),
  });
  deps.app = app;
  applyTheme(app, deps.theme);
  if (config.provider.contextWindow === undefined) fillContextWindow(app, config);

  try {
    await app.start();
  } finally {
    await app.stop();
    await kernel.agent.dispose().catch(() => undefined);
    // Kill background jobs before the process exits, or the spawned shells
    // outlive the session (the jobs dispose contract).
    await kernel.jobs.dispose().catch(() => undefined);
  }
}

/** `--theme` / `ui.theme` → 调色板；NO_COLOR 与终端能力由 detectCaps 定夺。 */
function applyTheme(app: TuiApp, theme: ThemeName): void {
  const caps = detectCaps();
  app.setPalette(buildPalette({ color: caps.color, truecolor: caps.truecolor, theme }));
}

/**
 * The context window denominator, resolved off the critical path: the surface
 * is already on screen, and a catalog that never arrives simply leaves the
 * gauge without a percentage (better than a `nova` that shows nothing for
 * however long the network takes).
 */
function fillContextWindow(app: TuiApp, config: Config): void {
  void createModelMetaStore()
    .lookup(config.provider.model, config.provider.baseURL)
    .then((meta) => {
      if (meta?.contextWindow !== undefined) app.setContextWindow(meta.contextWindow);
    })
    .catch(() => undefined);
}

/** 斜杠命令与技能调用：TUI 面。返回 `'handled'` = 已消费，字符串 = 送去提问。 */
async function runCommand(input: string, deps: Deps): Promise<string | 'handled' | undefined> {
  const { app, kernel, client } = deps;
  const [cmd = ''] = input.split(/\s+/);
  switch (cmd) {
    case '/exit':
    case '/quit':
      app.requestExit();
      return 'handled';
    case '/help':
    case '/session':
    case '/plugins':
    case '/mode':
      app.note(reportCommand(cmd, deps));
      return 'handled';
    case '/new': {
      const next = await kernel.newAgentSession();
      client.setSessionId(next.session.id);
      app.setAgent(next);
      app.note(newSessionLine(next.session.file));
      return 'handled';
    }
    case '/model':
      await openModelPanel(deps);
      return 'handled';
    case '/theme':
      switchTheme(input, deps);
      return 'handled';
    case '/approvals': {
      const next = nextApprovalMode(kernel.permission.approvalMode);
      kernel.permission.setMode(next);
      app.note(approvalSwitchLine(next));
      return 'handled';
    }
    case '/compact':
      await compactNow(deps);
      return 'handled';
    case '/clear':
      app.clear();
      return 'handled';
    case '/init':
      app.note(agentsMdWrittenLine(await writeAgentsMd(kernel.rootDir())));
      return 'handled';
    case '/skill': {
      const invocation = await expandSkillInvocation(input, kernel.skills);
      if (invocation === undefined) return undefined;
      if (!invocation.ok) {
        app.note(invocation.error, 'warn');
        return 'handled';
      }
      return invocation.content;
    }
    default: {
      const unknown = unknownCommandParts(cmd);
      app.note(`${unknown.head}${unknown.hint}`, 'warn');
      return 'handled';
    }
  }
}

/** The read-only reports: same pure builders as the repl, printed into a note. */
function reportCommand(cmd: string, deps: Deps): string {
  const { kernel } = deps;
  switch (cmd) {
    case '/help':
      return helpRows(COMMAND_SPECS).join('\n');
    case '/session':
      return sessionReportLines({
        file: kernel.agent.session.file,
        messageCount: kernel.agent.messages.length,
        stats: kernel.agent.usageSnapshot(),
        lastUsage: kernel.agent.lastUsage,
        lastPromptTokens: kernel.agent.lastPromptTokens,
        autoCompactTokenLimit: deps.config.autoCompactTokenLimit,
      }).join('\n');
    case '/plugins':
      return pluginReportLines({
        approvalMode: kernel.permission.approvalMode,
        override: deps.approvalOverride !== undefined,
        tools: kernel.host.toolEntries.map((entry) => ({
          plugin: entry.plugin,
          name: entry.tool.name,
          permission: permissionLabel(entry.permission),
        })),
        commands: kernel.host.commandEntries.map((entry) => ({
          plugin: entry.plugin,
          name: entry.command.name,
          description: entry.command.description,
        })),
      }).join('\n');
    default:
      return [
        `执行模式：${codeModeLabel(kernel.codeMode())}（未开会话前可用 Tab 切换）`,
        ...modeOverviewRows(kernel.codeMode()).map((row) => `  ${row.text}`),
      ].join('\n');
  }
}

/** `/model`: the catalog opens as a panel; picking a row retargets the client. */
async function openModelPanel(deps: Deps): Promise<void> {
  const { app, client } = deps;
  try {
    const models = await deps.modelCache();
    if (models.length === 0) {
      app.note(MODEL_LIST_EMPTY);
      return;
    }
    app.openPanel({
      title: `模型 · 当前 ${client.model}`,
      rows: models.map((model) => ({ label: model, detail: model === client.model ? '当前' : undefined })),
      onSelect: (index) => {
        const model = models[index];
        if (model === undefined) return;
        client.setModel(model);
        app.setModel(model);
        app.note(`模型已切换为 ${model}`);
      },
    });
  } catch (err) {
    app.note(modelListError(err), 'warn');
  }
}

function switchTheme(input: string, deps: Deps): void {
  const arg = input.trim().split(/\s+/)[1];
  if (arg === undefined) {
    deps.app.note(`当前主题：${deps.theme}（/theme dark|light|plain 切换；NO_COLOR 恒定无色）`);
    return;
  }
  const target = themeTarget(arg);
  if (target === undefined) {
    deps.app.note(themeUnknownMessage(arg), 'warn');
    return;
  }
  deps.theme = target;
  applyTheme(deps.app, target);
  deps.app.note(themeSwitchedMessage(target));
}

async function compactNow(deps: Deps): Promise<void> {
  const { app, kernel } = deps;
  if (kernel.agent.running) {
    app.note('本轮进行中，压缩会在轮结束后自动把关（或稍后再试）', 'warn');
    return;
  }
  app.note('正在压缩会话…');
  try {
    const outcome = await kernel.agent.compact('manual');
    app.note(`已压缩 — 摘要 ${outcome.summary.length} 字，保留 ${outcome.retained} 条最近消息`);
  } catch (err) {
    app.note(`压缩失败：${errMessage(err)}`, 'warn');
  }
}

/** Tab：未开会话前循环 普通 → PTC → 混合（重建宿主由内核 setCodeMode 负责）。 */
function cycleMode(deps: Deps): PtcMode | undefined {
  const order: PtcMode[] = ['native', 'ptc', 'both'];
  const next = order[(order.indexOf(deps.kernel.codeMode()) + 1) % order.length]!;
  void deps.kernel
    .setCodeMode(next)
    .then(() => {
      deps.app.setCodeMode(next);
      deps.app.note(`执行模式：${codeModeLabel(next)}`);
    })
    .catch((err: unknown) => deps.app.note(`切换失败：${errMessage(err)}`, 'warn'));
  return next;
}