/**
 * TUI 斜杠命令的呈现层（阶段 E 出壳）：命令核的行公式与正文已在
 * command-core 单源，本模块只承接 TUI 侧的「拼行 + 交互编排」。壳层状态
 * （paint/session/messages/主题/压缩态…）一律经访问器注入——paint 与
 * session 等会被 /theme、/new、会话切换重绑，值捕获会拿到旧引用。
 */
import {
  errMessage,
  type AgentMessage,
  type PtcMode,
  type Session,
  type UsageStats,
} from '@nova-agent/core';
import type { PermissionService, PluginHost } from '@nova-agent/plugins';
import {
  approvalLabel,
  CODE_MODE_HINT,
  codeModeLabel,
  humanTokens,
  padDisplay,
  permissionLabel,
  TOOL_GUTTER,
  type Palette,
} from '@nova-agent/tui-view';
import { COMMAND_SPECS } from '../commands.js';
import {
  agentsMdWrittenLine,
  approvalSwitchLine,
  cacheHitPct,
  helpRows,
  lastCacheHitPct,
  MODEL_LIST_EMPTY,
  modelListError,
  newSessionLine,
  nextApprovalMode,
  pluginCommandLine,
  pluginToolLine,
  THEME_NAMES,
  themeSwitchedMessage,
  themeTarget,
  themeUnknownMessage,
  unknownCommandParts,
  type ThemeName,
} from '../command-core.js';
import type { Config } from '../config.js';
import type { CompactedSession } from '../compact.js';
import { formatModelMeta, type ModelMeta } from '../model-meta.js';
import type { UsageAnchorState } from '../runner-loop.js';
import type { SessionEntry } from '../sessions.js';
import { cliVersion } from '../version.js';
import type { TuiStore } from './store.js';

export interface TuiCommandDeps {
  store: TuiStore;
  /** 访问器：/theme 运行中换主题后取到的必须是新调色板。 */
  paint(): Palette;
  render(): void;
  permission: PermissionService;
  approvalOverride: boolean;
  /** 访问器：rebuildHost/工作区切换会重绑 host。 */
  host(): PluginHost;
  codeMode(): PtcMode;
  currentModel(): string;
  fetchModelList(): Promise<string[]>;
  themeName(): ThemeName;
  /** 换主题：shell 写 themeName/paint + screen.invalidate + 重绘。 */
  applyTheme(name: ThemeName): void;
  /** 访问器：/new 与会话切换重绑。 */
  session(): Session;
  messages(): readonly AgentMessage[];
  stats: UsageStats;
  anchors: UsageAnchorState;
  config: Config;
  modelMeta(): ModelMeta | undefined;
  /** /session 的上下文结构图例行（shell 用当前 paint 与估算态组装）。 */
  contextLegendRow(): string;
  listSessions(): Promise<SessionEntry[]>;
  /** /new 全套序列（shell 编排 openFreshSession），返回新会话文件名。 */
  newSession(): Promise<string>;
  startCompactWait(): void;
  endCompactWait(): void;
  compactCancelled(): boolean;
  compactDoneLine(outcome: CompactedSession): string;
  runManualCompact(): Promise<CompactedSession>;
  /** /exit 前置：中断进行中的轮，让在途请求先解绕。 */
  abortAllTurns(): void;
  exit(): void;
  /** /clear：后台子代理行清场 + 开屏选择块塌缩 + 转录清空。 */
  clearView(): void;
  writeAgents(): Promise<string>;
}

export class TuiCommands {
  constructor(private readonly deps: TuiCommandDeps) {}

  async run(raw: string): Promise<void> {
    const d = this.deps;
    const store = d.store;
    const [cmd = ''] = raw.trim().split(/\s+/);
    switch (cmd) {
      case '/exit':
      case '/quit':
        // Reachable mid-turn now (stream-safe whitelist): stop the running
        // turn first so the in-flight request doesn't outlive the UI.
        d.abortAllTurns();
        d.exit();
        return;
      case '/help': {
        const p = d.paint();
        store.pushBlock([`  ${p.bold('命令')}`, ...helpRows(COMMAND_SPECS).map((row) => p.dim(row))]);
        return;
      }
      case '/model': {
        const p = d.paint();
        try {
          const models = await d.fetchModelList();
          if (models.length === 0) {
            store.pushBlock([p.dim(`  ${MODEL_LIST_EMPTY}`)]);
          } else {
            // Interactive picker overlay (↑↓ Enter Esc), not a history dump.
            const current = models.indexOf(d.currentModel());
            store.modelPicker = { models, index: Math.max(0, current) };
            d.render();
          }
        } catch (err) {
          store.pushBlock([p.red(`  ${modelListError(err)}`)]);
        }
        return;
      }
      case '/approvals': {
        const next = nextApprovalMode(d.permission.approvalMode);
        d.permission.setMode(next);
        store.pushBlock([d.paint().dim(`  ${approvalSwitchLine(next)}`)]);
        return;
      }
      case '/mode': {
        const p = d.paint();
        const codeMode = d.codeMode();
        store.pushBlock([
          `  ${p.bold('执行模式')} ${p.dim('· 仅对话开始前可按 Tab 循环切换')}`,
          ...(['native', 'ptc', 'both'] as PtcMode[]).map((m) =>
            m === codeMode
              ? `  ${p.cyan(p.bold(`❯ ${padDisplay(codeModeLabel(m), 6)}`))} ${CODE_MODE_HINT[m]}`
              : `    ${padDisplay(codeModeLabel(m), 6)} ${p.dim(CODE_MODE_HINT[m])}`,
          ),
          p.dim('  模式决定工具集呈现方式；切换立即生效（usage 锚点自动重置）'),
        ]);
        return;
      }
      case '/theme': {
        // 无参数：列出三主题并标当前。带参数：即时切换（applyTheme 内
        // screen.invalidate 全屏重绘；配置只作下次启动的持久值，不回写）。
        const p = d.paint();
        const arg = raw.trim().split(/\s+/)[1];
        if (arg === undefined) {
          const current = d.themeName();
          store.pushBlock([
            `  ${p.bold('主题')} ${p.dim('· /theme dark|light|plain 切换（NO_COLOR 恒定无色）')}`,
            ...THEME_NAMES.map((name) =>
              name === current
                ? `  ${p.cyan(p.bold(`❯ ${name}`))}`
                : `    ${p.dim(name)}`,
            ),
          ]);
          return;
        }
        const target = themeTarget(arg);
        if (target === undefined) {
          store.pushBlock([d.paint().red(`  ✗ ${themeUnknownMessage(arg)}`)]);
          return;
        }
        d.applyTheme(target);
        // 切换后按新主题上色（与旧实现同一顺序：invalidate 在前、反馈行在后）。
        store.pushBlock([d.paint().dim(`  ${themeSwitchedMessage(target)}`)]);
        return;
      }
      case '/plugins': {
        // 与 repl 同一信息量（审批档位 + 命令注册项此前只在 repl 有）。
        const p = d.paint();
        const host = d.host();
        store.pushBlock([
          `  ${p.bold('插件与工具')}${p.dim(
            ` · 审批档位 ${approvalLabel(d.permission.approvalMode)}${d.approvalOverride ? '（来自 --approval）' : ''}`,
          )}`,
          ...(host.toolEntries.length === 0
            ? [p.dim('  （没有已注册的工具）')]
            : host.toolEntries.map((entry) =>
                p.dim(`  ${pluginToolLine(entry.plugin, entry.tool.name, permissionLabel(entry.permission))}`),
              )),
          ...host.commandEntries.map((entry) =>
            p.dim(`  ${pluginCommandLine(entry.plugin, entry.command.name, entry.command.description)}`),
          ),
        ]);
        return;
      }
      case '/session': {
        const p = d.paint();
        const session = d.session();
        const hit = cacheHitPct(d.stats.promptTokens, d.stats.cachedTokens);
        const lastHit = lastCacheHitPct(d.anchors.lastUsage);
        const compact = d.config.autoCompactTokenLimit
          ? `阈值 ${humanTokens(d.config.autoCompactTokenLimit)} tok · 上轮 ${humanTokens(d.anchors.lastPromptTokens)} tok`
          : '未启用';
        const meta = d.modelMeta();
        store.pushBlock([
          `  ${p.bold('会话')}${p.dim(` · nova v${cliVersion()} · 模式 ${codeModeLabel(d.codeMode())}`)}`,
          p.dim(`  文件 ${session.file}`),
          p.dim(`  消息 ${d.messages().length} 条 · 日志事件 ${session.events.length} 条 · ${d.stats.turns} 轮`),
          p.dim(`  输入 ${d.stats.promptTokens} tok（缓存 ${hit}%${lastHit !== null ? ` · 上轮 ${lastHit}%` : ''}）· 输出 ${d.stats.completionTokens} tok`),
          p.dim(`  缓存浪费 ${d.stats.missTokens} tok · 超噪声底轮次 ${d.stats.missTurns}`),
          p.dim(`  自动压缩 ${compact}`),
          `  ${p.bold('模型')} ${d.currentModel()}`,
          meta !== undefined
            ? p.dim(`  ${formatModelMeta(meta)}（models.dev · ${meta.provider}）`)
            : p.dim('  元数据未命中（离线或目录没有该模型；可配 provider.contextWindow 兜底）'),
          d.contextLegendRow(),
        ]);
        try {
          const entries = await d.listSessions();
          if (entries.length > 0) {
            store.sessionPicker = {
              entries,
              index: Math.max(0, entries.findIndex((entry) => entry.file === session.file)),
            };
            d.render();
          }
        } catch (err) {
          store.pushBlock([d.paint().red(`  ✗ 会话列表读取失败：${errMessage(err)}`)]);
        }
        return;
      }
      case '/new': {
        const file = await d.newSession();
        store.pushBlock([d.paint().dim(`  ${newSessionLine(file)}`)]);
        return;
      }
      case '/compact': {
        d.startCompactWait();
        try {
          const outcome = await d.runManualCompact();
          d.endCompactWait();
          store.pushBlock([d.compactDoneLine(outcome)]);
        } catch (err) {
          d.endCompactWait();
          const p = d.paint();
          if (d.compactCancelled()) {
            store.pushBlock([p.yellow('  ■ 已取消压缩')], TOOL_GUTTER);
          } else {
            store.pushBlock([p.red(`  ✗ 压缩失败：${errMessage(err)}`)], TOOL_GUTTER);
          }
        }
        return;
      }
      case '/clear': {
        d.clearView();
        store.pushBlock([d.paint().dim('  （已清空显示，会话记录保留在磁盘）')]);
        return;
      }
      case '/init': {
        const file = await d.writeAgents();
        store.pushBlock([d.paint().green(`  ${agentsMdWrittenLine(file)}`)]);
        return;
      }
      default: {
        const p = d.paint();
        const unknown = unknownCommandParts(cmd);
        store.pushBlock([`${p.red(`  ${unknown.head}`)} ${p.dim(unknown.hint)}`]);
        return;
      }
    }
  }
}
