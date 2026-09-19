/**
 * `nova`（M11 批4d）：默认交互形态 = 全屏 TUI（`@nova-agent/tui-app` surface）。
 *
 * 与 repl 的关系是**同内核、两 surface**：装配（provider/config/审批覆盖/
 * jobs 订阅）走同一批小件；斜杠命令走同一个 runner（`command-runner`），
 * 只有呈现面不同（TUI 是卡片与面板，repl 打印行）。
 * 非 TTY（管道/CI）由 index.ts 回落 repl，本文件只负责 TUI 形态。
 */
import os from 'node:os';
import { errMessage, type PtcMode } from '@nova-agent/core';
import { createAgentKernel, type ApprovalMode, type Kernel } from '@nova-agent/plugins';
import { detectCaps } from '@nova-agent/tui';
import { TuiApp, buildPalette, type ThemeName } from '@nova-agent/tui-app';
import type { Config } from './config.js';
import { COMMAND_SPECS, createModelListCache } from './commands.js';
import { runAgentCommand, type CommandPorts } from './command-runner.js';
import { codeModeLabel } from './lines.js';
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

/**
 * 斜杠命令：TUI 面只出端口——语义（对内核做什么、参数怎么解析）全在
 * `command-runner` 里，两个壳共用；这里给的是呈现（note 进转录、模型选择走
 * 面板、清屏清转录）。
 */
function commandPorts(deps: Deps): CommandPorts {
  const { app, kernel, client } = deps;
  return {
    kernel,
    client,
    config: deps.config,
    approvalOverride: deps.approvalOverride,
    theme: () => deps.theme,
    setTheme: (theme) => {
      deps.theme = theme;
      applyTheme(app, theme);
    },
    note: (text, tone) => app.note(text, tone),
    fetchModels: () => deps.modelCache(),
    pickModel: (models) =>
      new Promise<string | undefined>((resolve) => {
        app.openPanel({
          title: `模型 · 当前 ${client.model}`,
          rows: models.map((model) => ({ label: model, detail: model === client.model ? '当前' : undefined })),
          // Esc 关面板时 `TuiApp` 回调 `-1`（"没选"），await 的那头才不会永远挂着。
          onSelect: (index) => resolve(index < 0 ? undefined : models[index]),
        });
      }),
    bindSession: (agent) => app.setAgent(agent),
    clear: () => app.clear(),
    modeHint: '（未开会话前可用 Tab 切换）',
    exit: () => app.requestExit(),
  };
}

/** `<TuiApp>` 的斜杠输入入口：命令 → 端口；技能展开成一句提问。 */
async function runCommand(input: string, deps: Deps): Promise<string | 'handled'> {
  const outcome = await runAgentCommand(input, commandPorts(deps));
  // `exit` 已经经端口把壳层关掉（`app.requestExit()`），这里只报"已消费"；
  // `/skill` 展开成提示词，交回 `TuiApp.submit` 去提问。
  return typeof outcome === 'object' ? outcome.prompt : 'handled';
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