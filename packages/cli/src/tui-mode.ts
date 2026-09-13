import { existsSync } from 'node:fs';
import path from 'node:path';
import { KeyDecoder, LineScreen, styledWidth, type Key } from '@nova-agent/tui';
import {
  APPROVAL_PREVIEW_MAX_ROWS,
  BREATHE_ROWS,
  COMPOSER_MAX_ROWS,
  REASONING_FULL_MAX_CHARS,
  REASONING_MAX_PARTIAL_CHARS,
  RENDER_BUDGET_MS,
  SESSION_LIST_LIMIT,
  STATUS_ROWS,
  SPINNER_TICK_MS,
  TOOL_ELAPSED_AFTER_MS,
  TOOL_TAIL_KEEP_CHARS,
  TOOL_TAIL_SHOW_CHARS,
} from '@nova-agent/tui-view';
import {
  emptyStats,
  estimateTextTokens,
  newId,
  runAgent,
  Session,
  type AgentEvent,
  type AgentMessage,
  type SubagentProgress,
  type Usage,
  type UsageStats,
  type UserMessage,
} from '@nova-agent/core';
import {
  builtinPlugins,
  codeRuntimeAvailable,
  PluginHost,
  skillsPlugin,
  type ApprovalMode,
  type AskFn,
  type PtcMode,
} from '@nova-agent/plugins';
import { writeAgentsMd } from './agents-md.js';
import { compactSession, surfaceDivergence } from './compact.js';
import { composerWrapBudget, cursorPosition, composerZone } from './composer.js';
import {
  COMMAND_SPECS,
  createModelListCache,
  filterCommands,
  type CommandSpec,
} from './commands.js';
import { novaHome, sessionDateBucket, sessionsRoot, type Config } from './config.js';
import { expandSkillInvocation, type SessionEnvInfo } from './context.js';
import { createMarkdownRenderer, type MarkdownRenderer } from './markdown.js';
import { reasoningLiveRow } from './reasoning.js';
import { createNotifier } from './notify.js';
import { createModelMetaStore, formatModelMeta, type ModelMeta } from './model-meta.js';
import { listRecentSessions, recordSessionWorkspace, sessionWorkspace } from './sessions.js';
import { createSessionRuntime } from './session-runtime.js';
import {
  approvalLabel,
  APPROVAL_ORDER,
  bottomStack,
  buildSplash,
  clipToWidth,
  contextGaugeForms,
  contextLegend,
  fitTail,
  humanTokens,
  isFailureContent,
  isReadOnlyTool,
  layoutComposer,
  messageQueueRows,
  padDisplay,
  palette,
  permissionLabel,
  plainPalette,
  REASONING_LIVE_KEEP_CHARS,
  REVEAL_CATCH_UP_TICKS,
  REVEAL_MIN_CHARS,
  REVEAL_TICK_MS,
  SPINNER_FRAMES,
  statusLine,
  StreamSmoother,
  subagentDetailRows,
  subagentLiveLine,
  TOOL_GUTTER,
  toolArgSummary,
  toolDoneLine,
  toolGroupLine,
  toolLabel,
  toolStartLine,
  type StopKind,
} from './ui.js';
import { buildApprovalPopup, buildCommandPopup, buildModelPopup, buildSessionPopup } from './popup.js';
import { agentRunBase, createApprovalService, createAutoCompact, LONG_TASK, maxTurnsHint, persistMissingToolResults } from './runner-shared.js';
import { flattenBlocks, invalidateWraps, sliceHistory, wrapBlock } from './tui/frame.js';
import { TuiStore, type Block } from './tui/store.js';
import { handleKey as tuiHandleKey, type KeyEnv } from './tui/keys.js';
import {
  codeModeLabel,
  contextBreakdown,
  gaugeCacheKey,
  statusBar,
  type ContextBreakdownView,
  type StatusView,
} from './statusbar.js';
import { cliVersion } from './version.js';

export interface TuiOptions {
  rootDir: string;
  config: Config;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
}

const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** Composer prompt prefix; the cursor column math depends on its width. */
// （COMPOSER_PREFIX / 宽度基准已移至 ./composer.ts——换行预算与光标列数都在那边。）

export async function startTui(opts: TuiOptions): Promise<void> {
  const { config } = opts;
  // The live workspace: follows the session across /session switches.
  let rootDir = opts.rootDir;
  const paint = process.stdout.isTTY === true ? palette : plainPalette;
  const screen = new LineScreen(process.stdout);
  const decoder = new KeyDecoder();

  // ---- persistent state -------------------------------------------------
  // 会话按日期归档（codex 式）：~/.nova/sessions/YYYY/MM/DD/，全局不分项目；
  // 溢出缓存在 ~/.nova/cache/tool-outputs/<session-id>/（id 全局唯一）。
  // 工作区（运行 nova 的目录）零写入。
  const newSessionDir = (): string => path.join(sessionsRoot(), sessionDateBucket());
  let sessionsDir = newSessionDir();

  // Visibility for nested subagent runs: the runner owns the live row. The
  // callback closes over onSubagentProgressRef (declared below with the live
  // row state); it is a plain ref so late calls always reach the current turn
  // even though the runtime wiring was fixed at session start.
  const rt = await createSessionRuntime({
    rootDir,
    config,
    resumeFile: opts.resumeFile,
    approvalOverride: opts.approvalOverride,
    subagentProgress: (progress) => onSubagentProgressRef.current(progress),
  });
  let messages: AgentMessage[] = rt.messages;
  let session: Session = rt.session;
  const client = rt.client;
  /** 站点模型目录（GET /models），/model 用；60s 缓存避免连续操作反复请求。 */
  const fetchModelList = createModelListCache(() => client.listModels());
  const jobs = rt.jobs;
  const stats: UsageStats = rt.stats;
  // 会话级缓存命中累计：provider 可能随机分流到不报缓存的后端，单轮 `stats`
  // 每轮 runAgent 从零重算 → 某轮 cachedTokens=0 会让 cache 段"闪现"消失。
  // 状态栏因此改看**会话累计**命中率，并粘住可见性：本会话只要见过一次缓存上报
  // （cacheSeen）就常驻，不再随单轮是否返回而忽有忽无；从未上报的 provider 则
  // 整段隐藏（不占屏缘宽度）。/new 与会话切换重置，compact 不重置（同一会话）。
  let sessPromptTokens = 0;
  let sessCachedTokens = 0;
  let cacheSeen = false;
  const resetSessionCache = (): void => {
    sessPromptTokens = 0;
    sessCachedTokens = 0;
    cacheSeen = false;
  };
  const approvalMode = rt.approvalMode;

  const bashConfig = rt.bashConfig;
  const codeConfig = rt.codeConfig;
  // 执行模式：TUI 里 Tab 在新会话开始时循环 普通 → PTC → 混合。config 的
  // tools.code.mode 只是初始值；其余 tools.code 调参（超时/预算）在每次
  // 重建 host 时原样带上。
  let codeMode: PtcMode = codeConfig?.mode ?? 'native';
  const bashPluginArgs = (): Parameters<typeof builtinPlugins>[0] => ({
    spillReadRoot: path.join(novaHome(), 'cache', 'tool-outputs'),
    bash:
      bashConfig?.enabled === false
        ? false
        : {
            ...(bashConfig?.timeoutMs !== undefined ? { timeoutMs: bashConfig.timeoutMs } : {}),
            ...(bashConfig?.shellPath !== undefined ? { shellPath: bashConfig.shellPath } : {}),
          },
    // 模型在任务中要求换工作区时（switch_workspace 工具），走与 /session
    // 切换相同的 applyWorkspace 通道：工具根、技能、环境片段 cwd 一致重建。
    // applyWorkspace 在首次 rebuildHost 时还没初始化——回调只在工具执行时
    // 触发，届时早已就绪。失败向上抛，工具结果如实回给模型。
    workspace: {
      onChange: async (dir: string) => {
        await applyWorkspace(dir);
        store.pushBlock([`${DIM}  ✓ 工作区已切换到 ${dir}${RESET}`]);
        scheduleRender();
      },
    },
    // 隔离子代理：同 provider、同审批门（hooks 经 rt.hooksRef 活读取）、
    // 无 subagent 自身（core 侧过滤防递归）。runner 级反馈由运行时接线
    // （opts.subagentProgress → onSubagentProgressRef）；此处的 bashPluginArgs
    // 只在 rebuildHost/Tab 切换时重建 host，不碰进度接线。
    subagent: {
      provider: client,
      tools: () => host.tools,
      hooks: () => rt.hooksRef.current,
      systemPrompt,
      ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
      rootDir: () => rootDir,
      onProgress: (progress) => onSubagentProgressRef.current(progress),
    },
    code: { ...codeConfig, mode: codeMode },
  });
  let skills = rt.skills;
  // The runtime's host lacks codeMode injection; rebuildHost() reactivates with
  // the correct PTC mode config before the first agent turn.
  let host = rt.host;

  /** models.dev 目录（上下文窗口/模态/推理能力）。启动后台刷新，断网用旧缓存。 */
  const modelMetaStore = createModelMetaStore();
  let currentModelMeta: ModelMeta | undefined;
  /** 每次成功解析后自增，驱动结构行的渲染缓存失效。 */
  let modelMetaVersion = 0;
  async function refreshModelMeta(): Promise<void> {
    try {
      currentModelMeta = await modelMetaStore.lookup(client.model, config.provider.baseURL);
    } catch {
      currentModelMeta = undefined; // 兜底：config.provider.contextWindow
    }
    modelMetaVersion += 1;
    // 不在历史区推送元数据块：窗口容量在结构条分母、能力标签在状态栏，
    // 底部两行是常驻视图，再打一条就是重复噪声。详情看 /session 与 /model。
    scheduleRender();
  }

  const sessionEnv: SessionEnvInfo = rt.sessionEnv;
  // AGENTS.md chain is session-stable by design; /init results land in the next session.
  // buildFragment is owned by the runtime (seedContextFragment uses it);
  // workspace switches call reloadWorkspaceContext to refresh docs+skills.
  const seedContextFragment = rt.seedContextFragment;
  const reloadWorkspaceContext = rt.reloadWorkspaceContext;
  // Usage anchors for pre-flight token estimates (dsh token-meter anchor +
  // delta repricing, whole-message granularity). Declared before rebuildHost
  // so the rebuild can reset them.
  let lastUsage: Usage | undefined;
  let lastPromptTokens = 0;
  let usageAnchor: Usage | undefined;
  let anchorMsgCount = 0;
  /**
   * Rebuild the plugin host for the current workspace + execution mode and
   * re-point `host`/`hooks` at it. Both the workspace switch and the Tab
   * mode toggle go through here: `host` is read live by runAgent (tools) and
   * `hooks` carries the beforeLLMCall projection that makes PTC mode visible,
   * so both must be re-derived from the SAME host on every rebuild.
   */
  const rebuildHost = async (): Promise<void> => {
    const next = new PluginHost(rootDir);
    for (const plugin of builtinPlugins(bashPluginArgs())) {
      next.use(plugin);
    }
    if (skills.length > 0) next.use(skillsPlugin(skills));
    await next.activate();
    host = next;
    hooks = next.agentHooks(permission);
    rt.hooksRef.current = hooks;
    // The tool set changed: the usage anchor's implicit assumption (schema
    // bytes unchanged since the anchored request) is void. Reset so the next
    // pre-flight estimate takes the full-estimate path instead of a delta
    // repricing against a stale anchor (P2-7).
    lastUsage = undefined;
    lastPromptTokens = 0;
    usageAnchor = undefined;
    anchorMsgCount = 0;
  };
  /**
   * Re-point the whole workspace-bound surface at `dir`: the tool host (fs
   * and bash resolve their root from the host per call), project skills,
   * AGENTS.md docs and the env fragment's cwd. Used when a switched-in
   * session was created in another workspace, so the restored fragment and
   * the tools agree — and /new afterwards seeds a consistent fragment.
   */
  const applyWorkspace = async (dir: string): Promise<void> => {
    rootDir = dir;
    sessionEnv.cwd = dir;
    skills = await reloadWorkspaceContext(dir);
    await rebuildHost();
  };
  /**
   * Approval popup + long-turn completion/error surface as OS notifications
   * too: the user regularly switches away while the agent works, and a
   * pending approval without a toast just looks like a frozen session.
   */
  const notify = createNotifier({ enabled: config.notify !== false });
  const askApproval: AskFn = (call, kind) =>
    new Promise((resolve) => {
      store.approval = { call, kind, resolve };
      store.approvalIndex = 0;
      store.approvalPreview = undefined;
      // Best-effort effect preview (edit_file's diff etc.) inside the popup —
      // the user approves what the call WILL do, not just the arg JSON.
      // Rendered when it lands; dropped when the popup already closed.
      const entry = host.toolEntries.find((e) => e.tool.name === call.name);
      if (entry !== undefined && entry.tool.preview !== undefined) {
        void Promise.resolve(entry.tool.preview(call.args, { rootDir }))
          .then((text) => {
            if (store.approval !== undefined && store.approval.call.id === call.id) {
              store.approvalPreview = text.trim().split('\n').slice(0, APPROVAL_PREVIEW_MAX_ROWS);
              scheduleRender();
            }
          })
          .catch(() => {});
      }
      store.scrollFromEnd = 0;
      notify('需要审批', `${toolLabel(call.name)} · ${toolArgSummary(call.name, call.rawArgs, 80)}`);
      scheduleRender();
    });
  const permission = createApprovalService(approvalMode, askApproval, () => session);
  // Reassigned by rebuildHost(): the agent loop must read hooks from the
  // SAME host instance it reads tools from (one rebuild = tools + projection).
  let hooks = host.agentHooks(permission);
  const systemPrompt = rt.systemPrompt;
  await rebuildHost();

  // ---- ui state ---------------------------------------------------------
  // 转录/输入/弹窗/审批/tps 状态全部收敛进 TuiStore（./tui/store.ts）：壳层
  // 不再闭包重声明字段，也不再手拼 TuiStore 形状的适配对象——按键责任链
  // （keys.ts）与渲染直接读写同一实例。仅 agent 态（usage 锚点等）留闭包。
  const store = new TuiStore(() => scheduleRender());
  /**
   * Esc closes the command palette until the input changes again — otherwise
   * the popup would instantly re-open on the next keystroke while typing a
   * non-command message that happens to start with "/".
   */
  const commandPopupMatches = (): CommandSpec[] => (store.popupDismissed ? [] : filterCommands(store.input));
  let exitNow: (() => void) | undefined;
  /**
   * 工具行的统一宽度预算。wrapBlock 按 `cols-1-gutter` 折行，行构建器必须
   * 裁进同一个预算——此前按 `cols-1` 裁，行恒比折行预算宽 6 列，
   * ` · N 行 · T.Ts` 尾巴整段被顶成孤儿续行（截图里的 `5.9s`）。
   */
  const toolBudget = (): number => store.budget(screen.cols);

  const spinner = {
    start() {
      spinnerTimer ??= setInterval(() => {
        store.spinnerFrame += 1;
        // Animate the bullet of every running tool block (codex-style
        // activity marker) and the composer-prefix spinner. After two
        // seconds a live elapsed suffix appears so a slow command never
        // looks frozen (Claude Code's bash progress counter).
        const frame = SPINNER_FRAMES[store.spinnerFrame % SPINNER_FRAMES.length] ?? '•';
        const now = Date.now();
        // 只在确有新增输出时推一个采样（门控在 TuiStore.sampleTps）——轮内的
        // 思考停顿 / 工具等待不推 0，否则连续几个 500ms 空窗会把 10 格窗口
        // 排空成"▁▁… 0"（用户看到的"偶尔清零"）。无新数据就只推进时钟、
        // 冻结窗口，速度表随真实产出左滚。
        store.sampleTps(now);
        // 被子代理活行接管的条目跳过重画——活行就是该 block 的当前真身，
        // 再画待定行会把同一行打回「调用 subagent …」（去重契约）。
        for (const [callId, entry] of store.toolBlocks) {
          if (subagentLive.has(callId)) continue;
          const elapsed = now - entry.startAt;
          const suffix = store.interruptAt > 0
            ? `${YELLOW} · 正在中断…${RESET}`
            : elapsed >= TOOL_ELAPSED_AFTER_MS
              ? `${DIM} · ${Math.floor(elapsed / 1000)}s${RESET}`
              : '';
          // 预算扣掉 suffix 的位（` · Ns` / ` · 正在中断…`），整行含后缀恒单行。
          const lines = [toolStartLine(paint, entry.name, entry.rawArgs, frame, toolBudget() - styledWidth(suffix)) + suffix];
          // Live output tail for streaming tools (bash): the last line of
          // whatever the process has printed so far. Code-point slice keeps
          // surrogate pairs intact.
          const tailBuf = entry.tailBuf;
          if (tailBuf !== undefined) {
            const last = [...tailBuf].slice(-TOOL_TAIL_SHOW_CHARS).join('').split('\n').pop()?.trimEnd() ?? '';
            if (last.length > 0) {
              lines.push(`      ${DIM}└ ${fitTail(last, Math.max(10, toolBudget() - 9))}${RESET}`);
            }
          }
          // Dirty-check: identical rows skip the replace (no wrap-cache churn).
          if (entry.block.lines.join('\n') !== lines.join('\n')) store.replaceBlock(entry.block, lines);
        }
        // Live subagent rows cycle their glyph with the same tick — a child
        // thinking between bursts never looks stalled (render is dirty-checked).
        for (const liveKey of subagentLive.keys()) renderSubagentLive(liveKey, frame);
        // The thinking glyph cycles even between token bursts: the spinner
        // tick re-renders the live reasoning rows (dirty-checked inside).
        if (store.reasoningBlock !== undefined) renderReasoningLive();
        scheduleRender();
      }, SPINNER_TICK_MS);
    },
    stop() {
      if (spinnerTimer !== undefined) {
        clearInterval(spinnerTimer);
        spinnerTimer = undefined;
      }
    },
  };
  let spinnerTimer: NodeJS.Timeout | undefined;

  let renderTimer: NodeJS.Timeout | undefined;
  const scheduleRender = (): void => {
    if (renderTimer !== undefined || exiting) return;
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      renderFrame();
    }, RENDER_BUDGET_MS);
  };
  // Key input bypasses the frame budget (pi-style preemption): a pending
  // scheduled frame is cancelled and the frame paints synchronously, so the
  // composer never feels behind the typist even while the spinner repaints.
  const preemptRender = (): void => {
    if (exiting) return;
    if (renderTimer !== undefined) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
    renderFrame();
  };

  // ---- agent ------------------------------------------------------------
  const aborters: AbortController[] = [];

  /**
   * Shared auto-compact orchestration (runner-shared): guards, anchor-reset
   * contract and error containment live there; only the presentation is local.
   */
  const { runCompact, maybePreCompact, maybeAutoCompact } = createAutoCompact({
    limit: config.autoCompactTokenLimit,
    request: () => ({ messages, systemPrompt, tools: host.tools }),
    state: {
      isRunning: () => store.compactRunning,
      setRunning: (v) => {
        store.compactRunning = v;
      },
      anchors: () => ({ usageAnchor, anchorMsgCount }),
      resetAnchors: () => {
        lastUsage = undefined;
        lastPromptTokens = 0;
        usageAnchor = undefined;
        anchorMsgCount = 0;
      },
      lastPromptTokens: () => lastPromptTokens,
      adoptSurface: (surface) => {
        messages = surface;
      },
    },
    compact: (trigger) => compactSession({ client, session, messages, trigger }),
    report: {
      preStart: (limit) => store.pushBlock([`${YELLOW}  ⋯ 预估下轮上下文超阈值 ${humanTokens(limit)}，提前压缩…${RESET}`]),
      postStart: (tokens) => store.pushBlock([`${YELLOW}  ⋯ 上下文 ${humanTokens(tokens)} tok 超阈值，正在压缩…${RESET}`]),
      success: (outcome) =>
        store.pushBlock([`${GREEN}  ✓ 已压缩${RESET} ${DIM}· 摘要 ${outcome.summary.length} 字 · 保留 ${outcome.retained} 条最近消息${RESET}`]),
      failure: (err, where) =>
        store.pushBlock(
          [`${RED}  ✗ ${where === 'pre' ? '预压缩' : '自动压缩'}失败：${err instanceof Error ? err.message : String(err)}${RESET}`],
          TOOL_GUTTER,
        ),
    },
  });

  /** Shared runAgent kwargs (runner-shared); per-call: signal + tool progress. */
  const agentRun = agentRunBase({
    client,
    session: () => session,
    rootDir: () => rootDir,
    messages: () => messages,
    tools: () => host.tools,
    hooks: () => hooks,
    jobs,
    systemPrompt,
    maxTurns: config.maxTurns,
  });

  // ---- subagent live view ------------------------------------------------
  // A foreground subagent run is fully synchronous for the parent turn — the
  // parent has no runAgent events of its own until the child settles, so
  // without this the user stares at a frozen tool line for minutes (codex
  // shows only start/completed, dsh only start/end + result; neither shows
  // liveness — this is nova's deliberate deviation). Core forwards nested
  // lifecycle moments via SubagentPluginOptions.onProgress; the shell pins
  // one live row per running child (keyed by the parent tool CALL — labels
  // are not unique) until the nested `done` remaps into the parent tool's
  // own result/done row.
  interface SubagentLiveState {
    label: string;
    lastTool?: string;
    toolCounts: Map<string, number>;
    turns: number;
    promptTokens: number;
    completionTokens: number;
    /** Nested execution log (tool lines + milestones), click-expand body. */
    detail: string[];
    startAt: number;
    block: Block;
  }
  const subagentLive = new Map<string, SubagentLiveState>();
  // Latest foreground subagent call this turn; its nested progress rows map
  // here. Reset on every tool result (a new subagent call re-pins it).
  const onSubagentProgressRef: { current: (progress: SubagentProgress) => void } = {
    current: () => undefined,
  };
  const renderSubagentLive = (callId: string, frame = '•'): void => {
    const st = subagentLive.get(callId);
    if (st === undefined) return;
    const head = subagentLiveLine(paint, {
      label: st.label,
      ...(st.lastTool !== undefined ? { lastTool: st.lastTool } : {}),
      toolCounts: st.toolCounts,
      turns: st.turns,
      promptTokens: st.promptTokens,
      completionTokens: st.completionTokens,
      expandable: st.detail.length > 0,
      expanded: st.block.expanded === true,
    }, frame);
    // Click-expand body rides on the block: the click chain (keys.ts) reads
    // block.detail/expanded, live re-renders must keep them in sync.
    const rows = subagentDetailRows(paint, st.detail, toolBudget());
    st.block.detail = { lines: rows, secs: Math.floor((Date.now() - st.startAt) / 1000), base: [head] };
    store.replaceBlock(st.block, st.block.expanded === true ? [head, ...rows] : [head]);
  };
  const removeSubagentLive = (callId: string): void => {
    const st = subagentLive.get(callId);
    if (st === undefined) return;
    subagentLive.delete(callId);
    // 接管模式：活行就是该调用的待定工具行本体，tool_call_result 紧随其后
    // 把同一 block 改写成完成行；只有兜底独立块（tool_call_start 行缺失时）
    // 才需要在这里移除。
    const entry = store.toolBlocks.get(callId);
    if ((entry === undefined || entry.block !== st.block) && store.blocks.includes(st.block)) {
      store.removeBlock(st.block);
    }
  };
  /** 中断/错误路径：活行等不到 result 改写，回退为静态停顿行后清场。 */
  const clearSubagentLive = (): void => {
    for (const [callId, st] of subagentLive) {
      const entry = store.toolBlocks.get(callId);
      if (entry !== undefined && entry.block === st.block) {
        const base = [toolStartLine(paint, entry.name, entry.rawArgs, '■', toolBudget())];
        // 已积累的嵌套日志保留可展开（中止了也看得到它做到了哪一步）。
        st.block.detail = { lines: subagentDetailRows(paint, st.detail, toolBudget()), secs: Math.floor((Date.now() - st.startAt) / 1000), base };
        st.block.expanded = false;
        store.replaceBlock(st.block, base);
      } else if (store.blocks.includes(st.block)) {
        store.removeBlock(st.block);
      }
    }
    subagentLive.clear();
    onSubagentProgressRef.current = () => undefined;
  };
  /** Nested-log cap: oldest entries fall off (memory-only detail). */
  const SUBAGENT_DETAIL_MAX = 200;
  const pushSubagentDetail = (st: SubagentLiveState, line: string): void => {
    st.detail.push(line);
    while (st.detail.length > SUBAGENT_DETAIL_MAX) st.detail.shift();
  };
  const onSubagentProgress = (callId: string, progress: SubagentProgress): void => {
    const key = callId;
    if (progress.type === 'start') {
      // 接管该调用的待定工具行：同一行从「调用 subagent …」变形为活行再到
      // 完成行，不再并排画两行同一件事（spinner 刻度跳过被接管的条目）。
      const entry = store.toolBlocks.get(key);
      const block = entry !== undefined ? entry.block : store.pushBlock([], TOOL_GUTTER);
      subagentLive.set(key, {
        label: progress.label,
        toolCounts: new Map(),
        turns: 0,
        promptTokens: 0,
        completionTokens: 0,
        detail: [`▸ ${progress.label}`],
        startAt: Date.now(),
        block,
      });
      renderSubagentLive(key);
    } else if (progress.type === 'tool_call') {
      const st = subagentLive.get(key);
      if (st === undefined) return;
      st.lastTool = progress.call.name;
      st.toolCounts.set(progress.call.name, (st.toolCounts.get(progress.call.name) ?? 0) + 1);
      pushSubagentDetail(st, `› ${progress.call.name} ${toolArgSummary(progress.call.name, progress.call.rawArgs, 80)}`);
      renderSubagentLive(key);
    } else if (progress.type === 'usage') {
      const st = subagentLive.get(key);
      if (st === undefined) return;
      st.turns = progress.stats.turns;
      st.promptTokens = progress.stats.promptTokens;
      st.completionTokens = progress.stats.completionTokens;
      renderSubagentLive(key);
    } else {
      // `done`: keep the live row until tool_call_result remaps it into the
      // parent tool's own done row (same frame the result is appended).
      const st = subagentLive.get(key);
      if (st === undefined) return;
      st.turns = progress.usage.turns;
      st.promptTokens = progress.usage.promptTokens;
      st.completionTokens = progress.usage.completionTokens;
      pushSubagentDetail(
        st,
        progress.status === 'completed'
          ? `✓ 完成 · ${progress.usage.turns} 轮 · ${progress.usage.toolCalls} 次工具 · ${(progress.usage.elapsedMs / 1000).toFixed(1)}s`
          : progress.status === 'aborted'
            ? '■ 已中止'
            : '■ 结束（无最终报告）',
      );
      renderSubagentLive(key);
    }
    scheduleRender();
  };

  /** Remove the live reasoning block once it ends: the answer, not the
   * thinking, is what the user came for — only the streaming tail is shown. */
  const discardReasoning = (): void => {
    if (store.reasoningBlock === undefined) return;
    store.removeBlock(store.reasoningBlock);
    store.reasoningBlock = undefined;
  };

  // ---- stream smoothing (codex-style typewriter) ------------------------
  // SSE deltas arrive in network bursts; both streams queue into smoothers
  // and a steady tick meters them into the visible blocks, so text flows
  // instead of lurching. Buffers hold the ARRIVAL truth for semantics
  // (assistantText/reasoningBuffer); only the DISPLAY is paced.
  const assistantStream = new StreamSmoother();
  const reasoningStream = new StreamSmoother();
  /** Revealed reasoning text — the display mirror the live rows render. */
  let reasoningShown = '';

  /** Recompute the live reasoning rows from the revealed buffer (dirty-checked). */
  const renderReasoningLive = (): void => {
    const block = store.reasoningBlock;
    if (block === undefined) return;
    const parts = reasoningShown.split('\n');
    const livePartial = (parts.pop() ?? '').replace(/\s+$/u, '').slice(-REASONING_MAX_PARTIAL_CHARS);
    const done = parts.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
    const lines = reasoningLiveRow(paint, {
      done,
      partial: livePartial,
      cols: screen.cols,
      spinnerFrame: store.spinnerFrame,
    });
    if (block.lines.join('\n') !== lines.join('\n')) store.replaceBlock(block, lines);
  };

  async function agentTurn(userInput: string): Promise<void> {
    const userMsg: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: userInput };
    messages.push(userMsg);
    await session.append(userMsg);
    // Spacing (Codex cell contract): store.blocks carry no manual separators —
    // flattenBlocks inserts the single blank row between non-empty store.blocks.
    store.pushBlock(
      [userInput],
      {
        first: `  ${CYAN}${BOLD}❯${RESET} ${BOLD}`,
        rest: `    ${BOLD}`,
      },
      'user',
    );

    await maybePreCompact();

    const aborter = new AbortController();
    aborters.push(aborter);
    store.streaming = true;
    spinner.start();
    store.genPhase = 'thinking';
    // tps 是会话级连续滚动速度表：新一轮不清空 ring、不把 store.tpsTokens 归零，
    // 新采样直接接在旧窗口左移，避免发送时"闪回 0"的跳变。只把基线锚到本轮
    // 起点——store.tpsLastTokens 取当前累计值，令本轮首个采样只计新输出的 token；
    // store.tpsLastAt 重置，把空闲间隔排除在首样分母外（否则跨分钟的 secs 会压出
    // 一个假 0）。store.tpsTokens 全程单调累加。
    store.tpsLastTokens = store.tpsTokens;
    store.tpsLastAt = Date.now();
    const startedAt = Date.now();
    let assistantText = '';
    let assistantOpen = false;
    let assistantBlock: Block | undefined;
    /** The blank separator block openAssistant pushes before each answer. */
    let assistantSeparator: Block | undefined;
    /** Incremental markdown renderer; re-created when a new answer opens. */
    let md: MarkdownRenderer | undefined;

    // ---- steady-tick reveal (typewriter) --------------------------------
    // Both streams drain here on a 30ms cadence; the timer parks itself when
    // nothing is pending and re-arms on the next delta.
    let revealTimer: NodeJS.Timeout | undefined;
    const stopReveal = (): void => {
      if (revealTimer !== undefined) {
        clearInterval(revealTimer);
        revealTimer = undefined;
      }
    };
    const revealTick = (): void => {
      const answer = assistantStream.take(REVEAL_MIN_CHARS, REVEAL_CATCH_UP_TICKS);
      if (answer.length > 0 && assistantBlock !== undefined && md !== undefined) {
        store.replaceBlock(assistantBlock, md.push(answer));
      }
      const thought = reasoningStream.take(REVEAL_MIN_CHARS, REVEAL_CATCH_UP_TICKS);
      if (thought.length > 0) {
        reasoningShown = (reasoningShown + thought).slice(-REASONING_LIVE_KEEP_CHARS);
        renderReasoningLive();
      }
      if (assistantStream.length === 0 && reasoningStream.length === 0) stopReveal();
      scheduleRender();
    };
    const ensureReveal = (): void => {
      revealTimer ??= setInterval(revealTick, REVEAL_TICK_MS);
    };
    /** Reveal whatever answer text is still pending (turn/closure end). */
    const flushAssistant = (): void => {
      const chunk = assistantStream.flush();
      if (chunk.length > 0 && assistantBlock !== undefined && md !== undefined) {
        store.replaceBlock(assistantBlock, md.push(chunk));
      }
    };
    /** Drop unrevealed text wholesale (abort / retry / turn teardown). */
    const clearStreams = (): void => {
      assistantStream.clear();
      reasoningStream.clear();
      reasoningShown = '';
      stopReveal();
    };

    /**
     * Reasoning, Codex-style: deltas accumulate in a memory buffer; the
     * transcript keeps ONE transient row (buffer tail, or the first **bold**
     * header once streamed in). Fold replaces it with a single "thought"
     * summary — nothing grows mid-turn, nothing reflows.
     */
    /** Raw reasoning buffer: memory-only, never rendered line-by-line. */
    let reasoningBuffer = '';
    /** Paragraph-split mirror of the buffer: the click-expand detail. */
    const reasoningFull: string[] = [];
    let reasoningOpen = false;
    /**
     * 思考段收尾（codex 风格）：思考只在流式期间滚动可见，一旦结束——答案
     * 开始、折叠调用、重试或中断——整块直接消失，转录里只留正式回答。
     * 思考正文仍进内存 buffer（REASONING_FULL_MAX_CHARS 裁尾），但不落盘、
     * 不留摘要行；此前折成的 `▸ 已思考 Ns` 摘要行按用户反馈取消。
     */
    const foldToSummary = (): boolean => {
      const had = store.reasoningBlock !== undefined && reasoningBuffer.trim().length > 0;
      reasoningBuffer = '';
      reasoningFull.length = 0;
      reasoningStream.clear();
      reasoningShown = '';
      discardReasoning();
      return had;
    };
    try {
      for await (const event of runAgent({
        ...agentRun(),
        // Live bash output lands in the running tool block's tail buffer; the
        // spinner tick renders it (never a render per chunk).
        onToolProgress: (text) => {
          const entry = store.activeToolId !== undefined ? store.toolBlocks.get(store.activeToolId) : undefined;
          if (entry === undefined) return;
          // Code-point slice (TuiStore.appendTail): a UTF-16 slice can split a
          // surrogate pair.
          store.appendTail(entry, text, TOOL_TAIL_KEEP_CHARS, TOOL_TAIL_SHOW_CHARS);
        },
        signal: aborter.signal,
      })) {
        await onAgentEvent(event, startedAt, {
          appendAssistant(text: string) {
            store.tpsTokens += estimateTextTokens(text);
            if (!assistantOpen) {
              // Whitespace-only leading deltas (models often emit blank lines
              // before tool calls) must not anchor a blank answer block above
              // the tool lines — skip them until real content arrives.
              if (text.trim().length === 0) return;
              assistantOpen = true;
              assistantText = '';
              assistantBlock = undefined;
              store.genPhase = 'writing';
              reasoningOpen = false;
              store.closeReadGroup();
              // Codex cell contract: margins belong to each cell. The thought
              // summary folded below already carries its own trailing blank,
              // so the answer opens with NO separator — flattenBlocks owns the
              // single blank row between non-empty store.blocks.
              foldToSummary();
              md = createMarkdownRenderer(paint);
              assistantSeparator = undefined;
              // The block opens empty; the reveal tick fills it (smoothing).
              assistantBlock = store.pushBlock([], { first: `  ${DIM}•${RESET} `, rest: '    ' }, 'assistant');
            }
            assistantText += text;
            // Queue for the typewriter — arrival truth stays in assistantText.
            assistantStream.push(text);
            ensureReveal();
          },
          appendReasoning(text: string) {
            store.tpsTokens += estimateTextTokens(text);
            if (assistantOpen && assistantText.trim().length > 0) return;
            if (assistantOpen && assistantText.trim().length === 0) {
              assistantOpen = false;
            }
            store.genPhase = 'thinking';
            if (!reasoningOpen) {
              reasoningOpen = true;
              reasoningBuffer = '';
              reasoningFull.length = 0;
              reasoningShown = '';
              // Auto-expanded while store.streaming: the newest reasoning lines are
              // visible live (tail-capped); completion folds them away. Every
              // row sits at the text column (no marker on the first row — an
              // unmarked first row at the marker column just reads as a
              // stray outdented line).
              store.pushBlock(['⋯'], { first: '    ', rest: '    ' }, 'reasoning');
              store.reasoningBlock = store.blocks[store.blocks.length - 1];
            }
            // The buffer is the truth (memory-only detail); the DISPLAY is
            // fed through the smoother — the live tail types out steadily
            // instead of lurching with each network burst.
            reasoningBuffer += text;
            if (reasoningBuffer.length > REASONING_FULL_MAX_CHARS) {
              reasoningBuffer = reasoningBuffer.slice(-REASONING_FULL_MAX_CHARS);
            }
            reasoningStream.push(text);
            ensureReveal();
          },
          closeAssistant() {
            // Nothing may stay unrevealed when the answer block closes.
            flushAssistant();
            if (assistantOpen && assistantText.trim().length === 0) {
              // A whitespace-only answer (blank lines before tool calls)
              // leaves no trace: drop the blank block and its separator by
              // identity — tool store.blocks may sit after them by now.
              if (assistantBlock !== undefined) store.removeBlock(assistantBlock);
              if (assistantSeparator !== undefined) store.removeBlock(assistantSeparator);
            }
            assistantOpen = false;
          },
          foldReasoning() {
            foldToSummary();
            reasoningBuffer = '';
            reasoningOpen = false;
          },
          resetAssistant() {
            // A provider retry replays the answer from scratch: the partial
            // text and its separator belong to the failed attempt — drop both.
            if (assistantBlock !== undefined) store.removeBlock(assistantBlock);
            if (assistantSeparator !== undefined) store.removeBlock(assistantSeparator);
            assistantBlock = undefined;
            assistantSeparator = undefined;
            assistantOpen = false;
            assistantText = '';
            // 重试的失败尝试不留任何痕迹（包括思考摘要行）。
            discardReasoning();
            reasoningOpen = false;
            reasoningBuffer = '';
            reasoningFull.length = 0;
            clearStreams();
          },
        });
      }
    } catch (err) {
      spinner.stop();
      store.closeReadGroup();
      // Repair the log before any surface work: the turn may have died with
      // assistant tool_calls unanswered — append synthesized results (same
      // copy core's abandonment synthesis uses) so the log keeps its
      // one-result-per-call contract.
      await persistMissingToolResults(session, messages).catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(message))) {
        // An abort may leave a partial assistant block that was never closed
        // (no 'message' event → never logged): drop it so the screen matches
        // the log. Committed text (assistantOpen === false) is kept.
        if (assistantOpen) {
          if (assistantBlock !== undefined) store.removeBlock(assistantBlock);
          if (assistantSeparator !== undefined) store.removeBlock(assistantSeparator);
          assistantBlock = undefined;
          assistantSeparator = undefined;
          assistantOpen = false;
          assistantText = '';
        }
        // An aborted turn reveals nothing more: pending text is dropped.
        clearStreams();
        store.pushBlock([`${YELLOW}  ■ 已中断${RESET}`]);
      } else {
        // A non-abort error mid-stream leaves a partial assistant block on
        // screen with no matching 'done' in the log — discard it to keep
        // screen and log in sync, then surface a dim hint.
        if (assistantOpen) {
          if (assistantBlock !== undefined) store.removeBlock(assistantBlock);
          if (assistantSeparator !== undefined) store.removeBlock(assistantSeparator);
          assistantBlock = undefined;
          assistantSeparator = undefined;
          assistantOpen = false;
          assistantText = '';
          store.pushBlock([`${DIM}  ⟳ 未完成的回答已丢弃（未写入会话日志）${RESET}`], TOOL_GUTTER);
        }
        clearStreams();
        // API errors can be long: hang wrapped rows under the notice column.
        store.pushBlock([`${RED}  ✗ 出错：${message}${RESET}`], TOOL_GUTTER);
        // A turn that died mid-work (not a user abort) deserves a ping too —
        // but only when it ran long enough that the user may have walked away.
        if (!exiting && Date.now() - startedAt >= LONG_TASK.errorMs) {
          notify('任务出错', message.slice(0, 120));
        }
      }
    } finally {
      const idx = aborters.indexOf(aborter);
      if (idx >= 0) aborters.splice(idx, 1);
      store.streaming = false;
      store.interruptAt = 0;
      store.genPhase = 'idle';
      spinner.stop();
      // 中断/出错时活行等不到 tool_call_result 的改写：回退为静态行并清场，
      // 否则「⧉ 子代理 … tok」的假活行会永远停在转录里。
      clearSubagentLive();
      // An abort/error never reaches the 'done' event: recycle the reasoning
      // tail here so no transient line survives into history.
      discardReasoning();
      reasoningOpen = false;
      reasoningBuffer = '';
      reasoningShown = '';
      clearStreams();
      store.closeReadGroup();
      // Runtime invariant (NOVA_DEBUG): the live surface must stay equal to
      // the session log projection — "model-visible means logged".
      if (process.env['NOVA_DEBUG'] !== undefined) {
        const divergence = surfaceDivergence(session, messages);
        if (divergence !== undefined) store.pushBlock([`${RED}  [invariant] ${divergence}${RESET}`]);
      }
      // Long turns end while the user is elsewhere: the toast is the "come
      // back, it's done" cue (short turns stay silent — that's just spam).
      const elapsed = Date.now() - startedAt;
      if (!exiting && elapsed >= LONG_TASK.doneMs) {
        notify('任务已完成', `本轮耗时约 ${Math.max(1, Math.round(elapsed / 1000 / 60))} 分钟，回到终端查看结果`);
      }
      scheduleRender();
    }
    await maybeAutoCompact();
    // 运行中排队的消息在此刻接续下发（自动压缩先走，避免新轮踩在压缩途中）。
    drainMessageQueue();
    scheduleRender();
  }

  async function onAgentEvent(
    event: AgentEvent,
    startedAt: number,
    io: {
      appendAssistant(text: string): void;
      appendReasoning(text: string): void;
      closeAssistant(): void;
      foldReasoning(): void;
      resetAssistant(): void;
    },
  ): Promise<void> {
    switch (event.type) {
      case 'turn_start':
        break;
      case 'llm_retry': {
        // The provider dropped the response mid-stream and is re-requesting:
        // discard the partial answer, adopt the corrected stats, and leave a
        // dim audit line. The failed attempt's usage stays a valid anchor —
        // the retry sends the same prompt prefix.
        Object.assign(stats, event.stats);
        io.resetAssistant();
        store.genPhase = 'thinking'; // 重新请求在途，属于"生成中"
        store.pushBlock([`${DIM}  ⟳ 上游流中断（${event.error}），自动重试 ${event.attempt}/${event.maxRetries}…${RESET}`], TOOL_GUTTER);
        break;
      }
      case 'text_delta':
        // Empty deltas do nothing: the assistant opens lazily on the first
        // non-blank delta, so reasoning phase is never reset by padding.
        if (event.text.length === 0) break;
        io.appendAssistant(event.text);
        break;
      case 'reasoning_delta':
        io.appendReasoning(event.text);
        break;
      case 'message': {
        io.closeAssistant();
        // Append EVERY assistant message, including content-less pure
        // tool-call turns: the log must mirror the model surface ("model
        // visible means logged"), or resume/compact projects orphan tool
        // results with no matching tool_calls.
        await session.append(event.message);
        break;
      }
      case 'tool_call_start': {
        // The reasoning phase ends when work begins; its transient tail is
        // removed and a later reasoning burst starts a fresh block.
        io.foldReasoning();
        store.genPhase = 'tool';
        // A new non-read call ends the current read-only group.
        if (!isReadOnlyTool(event.call.name)) store.closeReadGroup();
        // A foreground subagent pins `onSubagentProgressRef` at the current
        // parent call so its live row maps back here when it renders.
        onSubagentProgressRef.current =
          event.call.name === 'subagent' ? (progress) => onSubagentProgress(event.call.id, progress) : () => undefined;
        // Soft-wrapped continuation rows hang under the summary column.
        const block = store.pushBlock(
          [toolStartLine(paint, event.call.name, event.call.rawArgs, '•', toolBudget())],
          TOOL_GUTTER,
        );
        store.toolBlocks.set(event.call.id, { block, startAt: Date.now(), name: event.call.name, rawArgs: event.call.rawArgs });
        store.activeToolId = event.call.id;
        scheduleRender();
        break;
      }
      case 'tool_call_result': {
        await session.append(event.result);
        const entry = store.toolBlocks.get(event.call.id);
        store.toolBlocks.delete(event.call.id);
        if (store.activeToolId === event.call.id) store.activeToolId = undefined;
        // Capture before removal: the nested log stays click-expandable on
        // the DONE row (collapsed by default).
        const liveDetail = subagentLive.get(event.call.id);
        onSubagentProgressRef.current = () => undefined;
        removeSubagentLive(event.call.id);
        const duration = entry === undefined ? 0 : Math.max(0, Date.now() - entry.startAt);
        const failed = isFailureContent(event.result.content);
        if (isReadOnlyTool(event.call.name) && !failed) {
          // codex "Explored": the read's own line disappears and its summary
          // folds into the running group line.
          if (entry !== undefined) store.removeBlock(entry.block);
          // 宽预算存原文：公共目录折叠与最终排布都发生在 toolGroupLine 渲染时。
          const raw = toolArgSummary(event.call.name, event.call.rawArgs, 400);
          const summary = raw.length === 0 || raw === '{}' ? toolLabel(event.call.name) : raw;
          if (store.readGroup === undefined) {
            store.readGroup = {
              entries: [summary],
              startAt: entry === undefined ? Date.now() - duration : entry.startAt,
              block: store.pushBlock([], TOOL_GUTTER),
            };
          } else {
            store.readGroup.entries.push(summary);
          }
          store.replaceBlock(store.readGroup.block, [
            toolGroupLine(paint, store.readGroup.entries, Date.now() - store.readGroup.startAt, toolBudget()),
          ]);
        } else {
          store.closeReadGroup();
          const lines = toolDoneLine(
            paint,
            event.call.name,
            event.call.rawArgs,
            event.result.content,
            duration,
            toolBudget(),
          );
          // 完成行默认收起，但嵌套日志仍随 block 可点击展开（内存态，
          // resume 后不可展开——与 reasoning 详情同一契约）。
          if (liveDetail !== undefined && entry !== undefined && liveDetail.block === entry.block) {
            entry.block.detail = {
              lines: subagentDetailRows(paint, liveDetail.detail, toolBudget()),
              secs: Math.floor(duration / 1000),
              base: lines,
            };
            entry.block.expanded = false;
          }
          if (entry !== undefined) store.replaceBlock(entry.block, lines);
          else store.pushBlock(lines);
        }
        break;
      }
      case 'usage':
        Object.assign(stats, event.stats);
        lastUsage = event.usage;
        lastPromptTokens = event.usage.promptTokens;
        // Some gateways emit a usage chunk without prompt_tokens (client
        // coerces to 0): adopting it would collapse the gauge anchor to
        // "0 used" mid-turn until the next real report. Keep the previous
        // anchor instead — the delta path just keeps repricing against it.
        if (event.usage.promptTokens > 0) {
          usageAnchor = event.usage;
          anchorMsgCount = messages.length;
        }
        scheduleRender();
        break;
      case 'turn_aborted':
        await session.append(event.message);
        break;
      case 'done': {
        spinner.stop();
        // 累计本会话真实用量（此刻 stats = 本轮 runAgent 的累计）。done 每用户
        // 轮只触发一次，故按轮累加不会重复计同一 LLM 调用。见过缓存上报即置
        // cacheSeen——之后状态栏 cache 段常驻，不随某轮后端未返回而闪现。
        sessPromptTokens += stats.promptTokens;
        sessCachedTokens += stats.cachedTokens;
        if (stats.cachedTokens > 0) cacheSeen = true;
        store.closeReadGroup();
        io.foldReasoning();
        // A normal completion ends at the reply — no per-turn stats line (the
        // status bar carries tokens; /session carries details). Only abnormal
        // stops get a visible marker.
        if (event.stopReason !== 'complete') {
          const kind: StopKind = event.stopReason;
          store.pushBlock([statusLine(paint, kind, stats, Date.now() - startedAt)]);
          if (kind === 'max_turns') {
            store.pushBlock([
              `${DIM}${maxTurnsHint(config)}${RESET}`,
            ]);
          }
        }
        break;
      }
    }
  }

  // ---- execution mode (Tab) ---------------------------------------------
  /**
   * Tab 切换门控：只允许在对话开始前（消息里只有 seed 片段）切换——执行模式
   * 决定工具集与投影面，会话中途换模式会让已发生的轮次与新轮次工具语义不一
   * 致。中途按 Tab 不静默：走 noteModeSwitchBlocked 给出可见反馈。
   */
  const canSwitchMode = (): boolean =>
    messages.length <= 1 && !store.streaming && !store.compactRunning && !store.modeSwitching;

  const noteModeSwitchBlocked = (): void => {
    store.pushBlock([
      `${DIM}  执行模式只能在对话开始前切换（当前 ${codeModeLabel(codeMode)}，/mode 查看说明）${RESET}`,
    ]);
  };

  /**
   * 芯片呈现的"未开始"判据：三枚芯片并排仅在会话未开始时展示。
   */
  const displayPristine = (): boolean =>
    !store.streaming && !store.compactRunning && messages.length <= 1 && store.input.length === 0;

  const CODE_MODE_HINT: Record<PtcMode, string> = {
    native: '原生工具调用',
    ptc: '模型只见 run_code，其余工具以 TS 程序编排',
    both: 'run_code 与原生调用并存',
  };

  async function toggleCodeMode(): Promise<void> {
    const order: PtcMode[] = ['native', 'ptc', 'both'];
    const next = order[(order.indexOf(codeMode) + 1) % order.length] ?? 'native';
    if (next !== 'native' && !codeRuntimeAvailable()) {
      store.pushBlock([
        `${YELLOW}  ${codeModeLabel(next)}模式需要 Node ≥ 22.19（当前 ${process.version} 不支持类型剥离）${RESET}`,
      ]);
      return;
    }
    store.modeSwitching = true;
    const prev = codeMode;
    codeMode = next;
    scheduleRender();
    try {
      await rebuildHost();
      // 切换反馈：不依赖状态栏芯片也能看到（会话中途芯片塌成单枚，
      // 且 pristine 判据会随首条消息失效——没有这行用户以为 Tab 失灵）。
      store.pushBlock([`${DIM}  执行模式：${codeModeLabel(prev)} → ${codeModeLabel(next)}${RESET}`]);
    } catch (err) {
      // activate() 在 next host 上抛错：host/hooks 还没换，回滚模式即可。
      codeMode = prev;
      store.pushBlock([
        `${RED}  ✗ 模式切换失败：${err instanceof Error ? err.message : String(err)}${RESET}`,
        `${DIM}  已保持${codeModeLabel(prev)}模式${RESET}`,
      ]);
    } finally {
      store.modeSwitching = false;
      scheduleRender();
    }
  }

  // ---- commands ---------------------------------------------------------
  async function runCommand(raw: string): Promise<boolean> {
    const [cmd = ''] = raw.trim().split(/\s+/);
    switch (cmd) {
      case '/exit':
      case '/quit':
        // Reachable mid-turn now (stream-safe whitelist): stop the running
        // turn first so the in-flight request doesn't outlive the UI.
        for (const aborter of aborters) aborter.abort();
        exitApp();
        return true;
      case '/help': {
        const lines = COMMAND_SPECS.map((spec) => `${DIM}  ${padDisplay(spec.usage, 24)}${spec.description}${RESET}`);
        store.pushBlock([`  ${BOLD}命令${RESET}`, ...lines]);
        return true;
      }
      case '/model': {
        try {
          const models = await fetchModelList();
          if (models.length === 0) {
            store.pushBlock([`${DIM}  站点未返回任何模型${RESET}`]);
          } else {
            // Interactive picker overlay (↑↓ Enter Esc), not a history dump.
            const current = models.indexOf(client.model);
            store.modelPicker = { models, index: Math.max(0, current) };
            scheduleRender();
          }
        } catch (err) {
          store.pushBlock([`${RED}  模型列表获取失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
        }
        return true;
      }
      case '/approvals': {
        const idx = APPROVAL_ORDER.indexOf(permission.approvalMode);
        const next = APPROVAL_ORDER[(idx + 1) % APPROVAL_ORDER.length] ?? 'read-only';
        permission.setMode(next);
        store.pushBlock([`${DIM}  审批档位：${approvalLabel(next)}${RESET}`]);
        return true;
      }
      case '/mode': {
        store.pushBlock([
          `  ${BOLD}执行模式${RESET} ${DIM}· 仅对话开始前可按 Tab 循环切换${RESET}`,
          ...(['native', 'ptc', 'both'] as PtcMode[]).map((m) =>
            m === codeMode
              ? `  ${CYAN}${BOLD}❯ ${padDisplay(codeModeLabel(m), 6)}${RESET} ${CODE_MODE_HINT[m]}`
              : `    ${padDisplay(codeModeLabel(m), 6)} ${DIM}${CODE_MODE_HINT[m]}${RESET}`,
          ),
          `${DIM}  模式决定工具集呈现方式；切换立即生效（usage 锚点自动重置）${RESET}`,
        ]);
        return true;
      }
      case '/plugins': {
        const lines = host.toolEntries.map(
          (entry) => `${DIM}  插件=${entry.plugin} · 工具=${entry.tool.name} · 权限=${permissionLabel(entry.permission)}${RESET}`,
        );
        store.pushBlock([`  ${BOLD}插件与工具${RESET}`, ...lines]);
        return true;
      }
      case '/session': {
        const hit = stats.promptTokens > 0 ? Math.round((stats.cachedTokens / stats.promptTokens) * 100) : 0;
        const lastHit =
          lastUsage !== undefined && lastUsage.promptTokens > 0
            ? Math.round((lastUsage.cachedTokens / lastUsage.promptTokens) * 100)
            : null;
        const compact = config.autoCompactTokenLimit
          ? `阈值 ${humanTokens(config.autoCompactTokenLimit)} tok · 上轮 ${humanTokens(lastPromptTokens)} tok`
          : '未启用';
        store.pushBlock([
          `  ${BOLD}会话${RESET}${DIM} · nova v${cliVersion()} · 模式 ${codeModeLabel(codeMode)}${RESET}`,
          `${DIM}  文件 ${session.file}${RESET}`,
          `${DIM}  消息 ${messages.length} 条 · 日志事件 ${session.events.length} 条 · ${stats.turns} 轮${RESET}`,
          `${DIM}  输入 ${stats.promptTokens} tok（缓存 ${hit}%${lastHit !== null ? ` · 上轮 ${lastHit}%` : ''}）· 输出 ${stats.completionTokens} tok${RESET}`,
          `${DIM}  缓存浪费 ${stats.missTokens} tok · 超噪声底轮次 ${stats.missTurns}${RESET}`,
          `${DIM}  自动压缩 ${compact}${RESET}`,
          `  ${BOLD}模型${RESET} ${client.model}`,
          currentModelMeta !== undefined
            ? `${DIM}  ${formatModelMeta(currentModelMeta)}（models.dev · ${currentModelMeta.provider}）${RESET}`
            : `${DIM}  元数据未命中（离线或目录没有该模型；可配 provider.contextWindow 兜底）${RESET}`,
          `${DIM}  ${contextLegend(paint, contextBreakdown(contextView()).segments.filter((s) => s.tokens > 0))}${RESET}`,
        ]);
        try {
          const entries = await listRecentSessions(sessionsRoot(), SESSION_LIST_LIMIT);
          if (entries.length > 0) {
            store.sessionPicker = {
              entries,
              index: Math.max(0, entries.findIndex((entry) => entry.file === session.file)),
            };
            scheduleRender();
          }
        } catch (err) {
          store.pushBlock([`${RED}  ✗ 会话列表读取失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
        }
        return true;
      }
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
        resetSessionCache();
        await seedContextFragment(session, messages);
        store.pushBlock([`${DIM}  新会话：${session.file}${RESET}`]);
        return true;
      }
      case '/compact': {
        store.pushBlock([`${DIM}  ⋯ 正在压缩会话…${RESET}`]);
        try {
          const outcome = await runCompact('manual');
          store.pushBlock([
            `${GREEN}  ✓ 已压缩${RESET} ${DIM}· 摘要 ${outcome.summary.length} 字 · 保留 ${outcome.retained} 条最近消息${RESET}`,
          ]);
        } catch (err) {
          store.pushBlock([`${RED}  ✗ 压缩失败：${err instanceof Error ? err.message : String(err)}${RESET}`], TOOL_GUTTER);
        }
        return true;
      }
      case '/clear': {
        store.clearView();
        store.pushBlock([`${DIM}  （已清空显示，会话记录保留在磁盘）${RESET}`]);
        return true;
      }
      case '/init': {
        const file = await writeAgentsMd(rootDir);
        store.pushBlock([`${GREEN}  已写入 ${path.basename(file)}${RESET}`]);
        return true;
      }
      default:
        store.pushBlock([`${RED}  未知命令：${cmd}${RESET} ${DIM}（输入 /help 查看命令）${RESET}`]);
        return true;
    }
  }

  /**
   * Switch the live conversation to a past session: rebind the append-only
   * log, restore the model-visible surface, and replay user/assistant text
   * into a fresh transcript (tool traffic stays in the log, not re-rendered).
   */
  async function switchToSession(entry: { file: string }): Promise<void> {
    if (store.streaming || store.compactRunning) {
      store.pushBlock([`${YELLOW}  当前轮未结束：先 Esc 中断，再切换会话${RESET}`]);
      scheduleRender();
      return;
    }
    let loaded: Session;
    try {
      loaded = await Session.open(entry.file);
    } catch (err) {
      store.pushBlock([`${RED}  ✗ 会话读取失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
      scheduleRender();
      return;
    }
    const restored = loaded.deriveMessages();
    session = loaded;
    messages = restored;
    // Corruption tolerance reported at open: surface it like the REPL does —
    // a skipped damaged row or a repaired tail is worth knowing about.
    for (const warning of loaded.warnings) {
      store.pushBlock([`${YELLOW}  ⚠ ${warning}${RESET}`]);
    }
    // Rebind the cache-affinity identity and drop the old usage anchor (same
    // reasoning as /new): the restored history changes the prompt prefix, so
    // the next turn rebuilds the cache instead of tripping a spurious compact.
    client.setSessionId(loaded.id);
    Object.assign(stats, emptyStats());
    lastUsage = undefined;
    lastPromptTokens = 0;
    usageAnchor = undefined;
    anchorMsgCount = 0;
    resetSessionCache();
    store.clearView();
    store.activeToolId = undefined;
    // Follow the session back to the workspace it was created in, so the
    // restored context fragment and the tools' root agree again. Safety rail:
    // ~/.nova (sessions/skills/cache) is NEVER a valid workspace — a session
    // accidentally created inside the data dir must not drag the tools there.
    let workspaceLine: string | undefined;
    const target = sessionWorkspace(loaded);
    const novaDataDir = novaHome();
    const inNovaData = (dir: string): boolean => {
      const rel = path.relative(novaDataDir, dir);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };
    if (target !== undefined && inNovaData(target)) {
      workspaceLine = `${YELLOW}  ⚠ 会话记录的工作区指向 nova 数据目录（${target}），已忽略${RESET} ${DIM}（工具保持 ${rootDir}）${RESET}`;
    } else if (target !== undefined && target !== rootDir) {
      if (existsSync(target)) {
        await applyWorkspace(target);
        workspaceLine = `${GREEN}  ✓ 工作区已切换${RESET} ${DIM}${target}${RESET}`;
      } else {
        workspaceLine = `${YELLOW}  ⚠ 原工作区已不存在：${target}${RESET} ${DIM}（工具仍指向 ${rootDir}）${RESET}`;
      }
    }
    const userVisible = restored.filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0 && !m.content.trimStart().startsWith('<'),
    );
    if (userVisible.length === 0 && restored.length > 0) {
      store.pushBlock([
        `${DIM}  （该会话没有可回放的文本消息——可能被压缩投影或日志损坏截去；消息共 ${restored.length} 条）${RESET}`,
      ]);
    }
    for (const m of restored) {
      if (m.role === 'user') {
        if (m.content.trimStart().startsWith('<')) continue;
        store.pushBlock([m.content], { first: `  ${CYAN}${BOLD}❯${RESET} ${BOLD}`, rest: `    ${BOLD}` }, 'user');
      } else if (m.role === 'assistant' && m.content.trim().length > 0) {
        store.pushBlock([m.content], { first: `  ${DIM}•${RESET} `, rest: '    ' }, 'assistant');
      }
    }
    store.pushBlock([
      `${GREEN}  ✓ 已切换到会话${RESET} ${DIM}${path.basename(loaded.file)} · 上下文 ${restored.length} 条消息${RESET}`,
    ]);
    if (workspaceLine !== undefined) store.pushBlock([workspaceLine]);
    scheduleRender();
  }

  // ---- store.input handling ---------------------------------------------------
  /**
   * Commands that are safe to run WHILE a turn is streaming: read-only
   * queries and global switches. In particular /approvals must work mid-turn
   * — switching the gate mode while the agent works is the whole point.
   * Session-mutating commands (/new /compact /clear /init) stay blocked.
   */
  const STREAM_SAFE_COMMANDS = new Set(['/approvals', '/help', '/model', '/session', '/plugins', '/exit', '/quit']);

  async function handleSubmit(): Promise<void> {
    const text = store.input.trim();
    if (store.streaming || store.compactRunning) {
      const cmd = text.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (STREAM_SAFE_COMMANDS.has(cmd)) {
        store.input = '';
        store.cursorPos = 0;
        store.popupIndex = 0;
        void runCommand(text)
          .catch((err: unknown) => {
            store.pushBlock([`${RED}  ✗ 命令失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
            scheduleRender();
          })
          .then(() => scheduleRender());
        return;
      }
      // 运行中干预（codex 式消息队列）：轮进行中 Enter 不再拒绝——非命令
      // 正文入队，本轮结束后自动下发；队列行常驻 composer 上方可见。
      if (text.length > 0 && !text.startsWith('/')) {
        store.input = '';
        store.cursorPos = 0;
        store.popupIndex = 0;
        store.historyIdx = -1;
        store.historyStack.push(text);
        if (store.historyStack.length > 200) store.historyStack.shift();
        store.enqueueMessage(text);
        store.pushBlock([`${DIM}  ┃ 已排队 · 本轮结束后自动发送（Esc 可中断当前轮）${RESET}`]);
        scheduleRender();
        return;
      }
      store.pushBlock([
        `${DIM}  上一轮仍在进行：正文将排队在本轮结束后发送；/approvals /model /session /plugins 等查看类命令仍可用${RESET}`,
      ]);
      scheduleRender();
      return;
    }
    store.input = '';
    store.cursorPos = 0;
    store.popupIndex = 0;
    if (text.length === 0) {
      scheduleRender();
      return;
    }
    store.historyIdx = -1;
    store.historyStack.push(text);
    if (store.historyStack.length > 200) store.historyStack.shift();
    await dispatchUserText(text);
  }

  /** 技能展开 + 命令分发 + agentTurn 启动：handleSubmit 与队列下发共用。 */
  async function dispatchUserText(text: string): Promise<void> {
    let effective = text;
    const skillInvocation = await expandSkillInvocation(effective, skills);
    if (skillInvocation !== undefined) {
      if (!skillInvocation.ok) {
        store.pushBlock([`${RED}  ${skillInvocation.error}${RESET}`]);
        scheduleRender();
        return;
      }
      effective = skillInvocation.content;
    }

    if (effective.startsWith('/')) {
      void runCommand(effective)
        .catch((err: unknown) => {
          // /new, /init & co. do real IO: a failure must surface as a block,
          // not as an unhandled rejection that kills the process.
          store.pushBlock([`${RED}  ✗ 命令失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
          scheduleRender();
        })
        .then(() => scheduleRender());
      return;
    }
    store.scrollFromEnd = 0;
    void agentTurn(effective).catch((err: unknown) => {
      // agentTurn has its own try/catch around the event loop, but an error
      // OUTSIDE that loop (building the fragment, the approval plumbing, …)
      // would escape as an unhandled rejection. Surface it as a block instead.
      spinner.stop();
      store.pushBlock([`${RED}  ✗ 本轮失败：${err instanceof Error ? err.message : String(err)}${RESET}`], TOOL_GUTTER);
      store.streaming = false;
      scheduleRender();
    });
  }

  /**
   * 队列下发：本轮结束（正常完成、出错或 Esc 中断）后取队首继续。中断后
   * 接着发队首正是"打断 + 干预"的语义——用户打断是为了说下一句话。
   */
  function drainMessageQueue(): void {
    if (exiting) return;
    const next = store.dequeueMessage();
    if (next === undefined) return;
    void dispatchUserText(next);
  }

  function totalWrappedLines(): number {
    let total = 0;
    for (const block of store.blocks) {
      total += wrapBlock(block, screen.cols).length;
    }
    return total;
  }

  const keyEnv: KeyEnv = {
    store,
    paint,
    cols: () => screen.cols,
    rows: () => screen.rows,
    abortLast: () => {
      store.interruptAt = Date.now();
      aborters.at(-1)?.abort();
    },
    exitApp,
    scheduleRender,
    preemptRender,
    submit: () => void handleSubmit(),
    toggleCodeMode: () => void toggleCodeMode(),
    canSwitchMode,
    noteModeSwitchBlocked,
    switchModel: (model) => {
      client.setModel(model);
      store.pushBlock([`${DIM}  模型已切换为 ${model}${RESET}`]);
      void refreshModelMeta();
    },
    switchSessionFile: (file) => void switchToSession({ file }),
    currentModel: () => client.model,
    currentSessionFile: () => session.file,
    refreshModelMeta: () => void refreshModelMeta(),
    popupMatches: () => commandPopupMatches(),
    totalWrappedLines,
    notice: (lines) => store.pushBlock(lines.map((l) => `${DIM}${l}${RESET}`)),
  };

  function handleKey(k: Key): void {
    tuiHandleKey(keyEnv, k);
  }


  // ---- rendering --------------------------------------------------------
  let cachedFlatten:
    | { cols: number; version: number; result: { flat: string[]; rowMap: { block: Block; start: number; count: number }[] } }
    | undefined;

  function renderFrame(): void {
    if (exiting) return;
    const cols = screen.cols;
    const rows = screen.rows;

    const matches = commandPopupMatches();
    const popupOpen =
      store.approval === undefined &&
      store.modelPicker === undefined &&
      store.sessionPicker === undefined &&
      matches.length > 0;

    const popupLines: string[] = [];
    if (store.approval !== undefined) {
      // 弹窗行折行会把整体顶出视口：头部与 diff 预览都按剩余列数裁剪（纯
      // 构建器在 ./popup.ts，键交互留在 handleKey 的责任链层）。
      popupLines.push(
        ...buildApprovalPopup(
          paint,
          {
            permissionLabel: permissionLabel(store.approval.kind),
            toolLabel: toolLabel(store.approval.call.name),
            argSummary: toolArgSummary(store.approval.call.name, store.approval.call.rawArgs, 100),
            previewLines: store.approvalPreview,
            index: store.approvalIndex,
            isExecuteKind: store.approval.kind === 'execute',
          },
          cols,
        ),
      );
    } else if (store.modelPicker !== undefined) {
      // Model catalog in a bordered panel with a sliding window: long lists
      // scroll inside the popup instead of flooding the transcript.
      popupLines.push(
        ...buildModelPopup(
          paint,
          {
            items: store.modelPicker.models.map((name) => ({
              name,
              contextTokens: modelMetaStore.peek(name, config.provider.baseURL)?.contextWindow,
            })),
            index: store.modelPicker.index,
            current: client.model,
          },
          cols,
        ),
      );
    } else if (store.sessionPicker !== undefined) {
      // Session switcher: bordered panel like the model picker, a sliding
      // window over the newest sessions, current one marked.
      popupLines.push(
        ...buildSessionPopup(
          paint,
          {
            items: store.sessionPicker.entries.map((entry) => ({
              mtime: entry.mtime,
              title: entry.title,
              isCurrent: entry.file === session.file,
            })),
            index: store.sessionPicker.index,
          },
          cols,
        ),
      );
    } else if (popupOpen) {
      // Bordered dropdown matching the composer box; the selected row is
      // inverse-video across the full row width, not just the label.
      // buildCommandPopup owns the sliding window + relative highlight — the
      // caller used to pre-slice AND pass the absolute index, which threw the
      // selection outside the visible list.
      popupLines.push(...buildCommandPopup(paint, { matches, index: store.popupIndex }, cols));
    }

    // One breathing row between the newest content and the composer.
    const layout = layoutComposer(store.input, store.cursorPos, composerWrapBudget(cols), COMPOSER_MAX_ROWS);
    const composerZoneRows = composerZone(paint, layout, {
      spinnerFrame: store.spinnerFrame,
      streaming: store.streaming,
      genPhase: store.genPhase,
    });
    // 运行中排队的消息：composer 上方的暗色 lane，始终可见（图 2 队列语义）。
    const queueLines = messageQueueRows(paint, store.messageQueue, cols);
    // 单行状态区：上下文仪表+模型+模式芯片+审批 ｜ tps+cache 钉右缘。
    if (cachedFlatten === undefined || cachedFlatten.cols !== cols || cachedFlatten.version !== store.blocksVersion) {
      cachedFlatten = { cols, version: store.blocksVersion, result: flattenBlocks(store.blocks, cols) };
    }
    const { flat, rowMap } = cachedFlatten.result;
    const historyBudget = rows - popupLines.length - queueLines.length - composerZoneRows.length - STATUS_ROWS - BREATHE_ROWS;
    const { lines: historyLines, sliceStart, maxScroll } = sliceHistory(flat, historyBudget, store.scrollFromEnd);
    if (store.scrollFromEnd > maxScroll) store.scrollFromEnd = maxScroll;
    store.frameMap = { rows: rowMap, sliceStart, historyRows: historyLines.length };

    // 按显示宽裁剪：绝不折行顶动布局（statusBar 内部已做截左保右）。
    const status = clipToWidth(statusBar(paint, statusView()), cols - 1);

    screen.render(
      bottomStack(historyLines, popupLines, queueLines, composerZoneRows, status),
      cursorPosition({ historyRows: historyLines.length, popupRows: popupLines.length, queueRows: queueLines.length, layout }),
    );
  }

  /**
   * 上下文分解的渲染快照（纯计算在 ./statusbar.ts）。/session 明细与
   * 仪表缓存共用同一份，保证两处读数一致。
   */
  const contextView = (): ContextBreakdownView => ({
    systemPrompt,
    tools: host.tools,
    messages,
    usageAnchor,
    anchorMsgCount,
    contextWindow: config.provider.contextWindow,
    modelMetaContextWindow: currentModelMeta?.contextWindow,
  });

  /**
   * 上下文仪表段（三档形态一次算全，按 key 缓存）：分段明细在 `/session`，
   * 这里按档位给出 全量/去冗/最简 三种形态供状态栏选档。容量取 models.dev
   * 元数据（config.provider.contextWindow 兜底），条严格按整窗比例分摊。
   * 缓存留在壳层：重算要对 messages 全量估算，每 tick 一遍是性能雷区。
   */
  let contextLineCache: { key: string; lines: [string, string, string] } | undefined;
  function gaugeForms(): [string, string, string] {
    const capacity = config.provider.contextWindow ?? currentModelMeta?.contextWindow;
    const key = gaugeCacheKey({
      messagesLen: messages.length,
      usageAnchor,
      model: client.model,
      codeMode,
      modelMetaVersion,
      capacity,
      toolCount: host.tools.length,
      compactLimit: config.autoCompactTokenLimit,
      cols: screen.cols,
    });
    if (contextLineCache === undefined || contextLineCache.key !== key) {
      const { segments, used, capacity: cap } = contextBreakdown(contextView());
      contextLineCache = {
        key,
        lines: contextGaugeForms(paint, { segments, used, capacity: cap, compact: config.autoCompactTokenLimit }, screen.cols),
      };
    }
    return contextLineCache.lines;
  }

  /** 状态栏的帧快照：闭包可变状态 → 纯函数入参（见 ./statusbar.ts）。 */
  const statusView = (): StatusView => ({
    cols: screen.cols,
    model: client.model,
    approvalMode: permission.approvalMode,
    codeMode,
    pristine: displayPristine(),
    streaming: store.streaming,
    interruptAt: store.interruptAt,
    inputEmpty: store.input.length === 0,
    lastCtrlC: store.lastCtrlC,
    now: Date.now(),
    tpsRing: store.tpsRing,
    tpsSamples: store.tpsSamples,
    promptTokens: sessPromptTokens,
    cachedTokens: sessCachedTokens,
    cacheSeen,
    gaugeForms: gaugeForms(),
  });

  // ---- lifecycle --------------------------------------------------------
  function exitApp(): void {
    if (exiting) return;
    exiting = true;
    spinner.stop();
    if (escTimer !== undefined) {
      clearTimeout(escTimer);
      escTimer = undefined;
    }
    void jobs.dispose();
    screen.exit();
    process.stdin.setRawMode(false);
    process.stdin.pause();
    exitNow?.();
  }
  let exiting = false;

  let escTimer: NodeJS.Timeout | undefined;
  process.stdin.on('data', (chunk: Buffer) => {
    if (escTimer !== undefined) {
      clearTimeout(escTimer);
      escTimer = undefined;
    }
    for (const key of decoder.push(chunk)) handleKey(key);
    // A lone ESC might be the head of a sequence split across chunks; only
    // treat it as the Esc key once no continuation arrives shortly.
    if (decoder.hasPendingEsc()) {
      escTimer = setTimeout(() => {
        escTimer = undefined;
        const key = decoder.flushPendingEsc();
        if (key !== undefined) handleKey(key);
      }, 32);
    }
    preemptRender();
  });
  process.stdout.on('resize', () => {
    invalidateWraps(store.blocks);
    store.blocksVersion += 1;
    screen.invalidate();
    scheduleRender();
  });
  process.on('SIGINT', () => {
    if (store.streaming) {
      store.interruptAt = Date.now();
      aborters.at(-1)?.abort();
      scheduleRender();
    } else exitApp();
  });

  // run
  try {
    screen.enter();
  } catch {
    screen.exit();
    const { startRepl } = await import('./repl.js');
    await startRepl({ rootDir, config, resumeFile: opts.resumeFile, approvalOverride: opts.approvalOverride });
    return;
  }
  try {
    process.stdin.setRawMode(true);
  } catch {
    screen.exit();
    const { startRepl } = await import('./repl.js');
    await startRepl({ rootDir, config, resumeFile: opts.resumeFile, approvalOverride: opts.approvalOverride });
    return;
  }
  process.stdin.resume();
  // models.dev 目录后台加载（磁盘缓存在即秒回）；到达后结构行自动换容量。
  void refreshModelMeta();

  // Splash: layered destination → identity → action (tui-view/splash.ts).
  store.pushBlock(
    buildSplash(paint, {
      rootDir,
      sessionsRoot: sessionsRoot(),
      model: client.model,
      approval: approvalMode,
      codeMode,
      version: cliVersion(),
      skills: skills.map((s) => s.name),
      warnings: session.warnings,
      cols: screen.cols,
    }),
  );

  await new Promise<void>((resolve) => {
    exitNow = resolve;
  });
  console.log(`会话已保存：${session.file}`);
}
