/**
 * The TUI surface plugin (`nova --tui`): a dynamically-registered `AgentSurface`
 * the cli loads from `~/.nova/config.json` `surfaces`, not a hardcoded entry.
 *
 * This module owns the surface-package half of assembly that used to live in
 * `cli/src/tui-mode.ts`: it builds `TuiApp` from the host-lent runtime, owns
 * the theme application and the Tab cycle, and provides the presentation half
 * of the slash-command port (`AgentSurfaceUi`). The host (cli) owns the kernel
 * assembly, the provider and the one slash-command runner — so this package
 * depends only on `core`/`plugins`/`tui`, never on the cli.
 *
 * Loaded the same way a third-party surface is: a config row names this module
 * (`@nova-agent/tui-app/surface` or a path), `loadSurfacePlugins` imports it,
 * and the registry asks it `claim(request)`. Replacing it is a config edit.
 */
import {
  errMessage,
  type AgentSurface,
  type AgentSurfaceRuntime,
  type AgentSurfaceUi,
  type PtcMode,
} from '@nova-agent/core';
import { detectCaps } from '@nova-agent/tui';
import { TuiApp } from './app.js';
import { buildPalette, type ThemeName } from './theme.js';

export const tuiSurface: AgentSurface = {
  name: 'tui',
  interactive: true,
  answersQuestions: true,
  // Forced, and only with a terminal on both ends: the terminal UI draws a
  // full-screen frame and needs raw keys, neither of which exists down a pipe.
  // `--tui` outranks the browser default but yields to `--repl` (an explicit
  // request for the plainest fallback is never a mistake to override).
  claim: (request) => request.flags.tui && !request.flags.repl && request.interactive,
  start: (runtime) => startTuiSurface(runtime),
};

export default tuiSurface;
/** Alias for modules that prefer the named `surface` export. */
export const surface = tuiSurface;

async function startTuiSurface(runtime: AgentSurfaceRuntime): Promise<void> {
  const { kernel, commands } = runtime;
  let theme: ThemeName = runtime.theme as ThemeName;

  const app = new TuiApp({
    agent: kernel.agent,
    tools: () => kernel.host.toolEntries.map((entry) => entry.tool),
    rootDir: kernel.rootDir(),
    homeDir: runtime.homeDir,
    skills: kernel.skills.length,
    model: runtime.model(),
    codeMode: kernel.codeMode(),
    commands: commands.catalog(),
    ...(runtime.contextWindow !== undefined ? { contextWindow: runtime.contextWindow } : {}),
    ...(runtime.autoCompactTokenLimit !== undefined ? { autoCompactTokenLimit: runtime.autoCompactTokenLimit } : {}),
    onCommand: (text) => onCommand(text),
    onCycleMode: () => cycleMode(),
  });

  applyTheme(app, theme);
  // The context-window denominator, resolved off the critical path: the surface
  // is already on screen, and a catalog that never arrives leaves the gauge
  // without a percentage rather than a blank terminal.
  if (runtime.contextWindow === undefined && runtime.resolveContextWindow !== undefined) {
    void runtime
      .resolveContextWindow()
      .then((window) => {
        if (window !== undefined) app.setContextWindow(window);
      })
      .catch(() => undefined);
  }

  const ui: AgentSurfaceUi = {
    note: (text, tone) => app.note(text, tone),
    clear: () => app.clear(),
    bindSession: (agent) => app.setAgent(agent),
    theme: () => theme,
    setTheme: (next) => {
      theme = next as ThemeName;
      applyTheme(app, theme);
    },
    pickModel: (models) =>
      new Promise<string | undefined>((resolve) => {
        app.openPanel({
          title: `模型 · 当前 ${runtime.model()}`,
          rows: models.map((model) => ({
            label: model,
            detail: model === runtime.model() ? '当前' : undefined,
          })),
          // Esc 关面板时 `TuiApp` 回调 `-1`（"没选"），await 的那头才不会永远挂着。
          onSelect: (index) => resolve(index < 0 ? undefined : (models[index] ?? undefined)),
        });
      }),
    modeHint: '（未开会话前可用 Tab 切换）',
    exit: () => app.requestExit(),
  };

  /** `<TuiApp>` 的斜杠输入入口：命令 → 端口；技能展开成一句提问。 */
  async function onCommand(text: string): Promise<string | 'handled'> {
    const outcome = await commands.run(text, ui);
    // `exit` 已经经端口把壳层关掉（`app.requestExit()`），这里只报"已消费"；
    // `/skill` 展开成提示词，交回 `TuiApp.submit` 去提问。
    return typeof outcome === 'object' ? outcome.prompt : 'handled';
  }

  /** Tab：未开会话前循环 普通 → PTC → 混合（重建宿主由内核 setCodeMode 负责）。 */
  function cycleMode(): PtcMode | undefined {
    const order: PtcMode[] = ['native', 'ptc', 'both'];
    const next = order[(order.indexOf(kernel.codeMode()) + 1) % order.length]!;
    void kernel
      .setCodeMode(next)
      .then(() => {
        app.setCodeMode(next);
        app.note(`执行模式：${ptcModeLabel(next)}`);
      })
      .catch((err: unknown) => app.note(`切换失败：${errMessage(err)}`, 'warn'));
    return next;
  }

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

/** TUI's own mode labels (surface-owned copy, per AGENTS.md §5: 文案归各 surface). */
function ptcModeLabel(mode: PtcMode): string {
  switch (mode) {
    case 'native':
      return '普通';
    case 'ptc':
      return 'PTC';
    case 'both':
      return '混合';
  }
}
