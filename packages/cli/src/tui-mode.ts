import { existsSync } from 'node:fs';
import path from 'node:path';
import { KeyDecoder, LineScreen, detectCaps, type Key } from '@nova-agent/tui';
import {
  APPROVAL_PREVIEW_MAX_ROWS,
  BREATHE_ROWS,
  COMPOSER_MAX_ROWS,
  HISTORY_LIMIT,
  RENDER_BUDGET_MS,
  SESSION_LIST_LIMIT,
  STATUS_ROWS,
  SPINNER_TICK_MS,
  resolvePalette,
} from '@nova-agent/tui-view';
import {
  errMessage,
  emptyStats,
  estimateTextTokens,
  runAgent,
  Session,
  type AgentEvent,
  type AgentMessage,
  type SubagentProgress,
  type UsageStats,
} from '@nova-agent/core';
import {
  codeRuntimeAvailable,
  type ApprovalMode,
  type AskFn,
  type PtcMode,
} from '@nova-agent/plugins';
import { writeAgentsMd } from './agents-md.js';
import { compactSession, surfaceDivergence } from './compact.js';
import { composerWrapBudget, cursorPosition, composerZone } from './composer.js';
import { COMMAND_SPECS, filterCommands, type CommandSpec } from './commands.js';
import {
  cacheHitPct,
  lastCacheHitPct,
  MODEL_LIST_EMPTY,
  modelListError,
  nextApprovalMode,
  openFreshSession,
  pluginCommandLine,
  pluginToolLine,
} from './command-core.js';
import { newSessionDir, novaHome, sessionsRoot, type Config } from './config.js';
import { expandSkillInvocation, type SessionEnvInfo } from './context.js';
import { createNotifier } from './notify.js';
import { renderMarkdownLite } from './markdown.js';
import { createModelMetaStore, formatModelMeta, type ModelMeta } from './model-meta.js';
import { listRecentSessions, recordSessionWorkspace, sessionWorkspace } from './sessions.js';
import { createSessionRuntime } from './session-runtime.js';
import {
  commitUserMessage,
  createRunnerBookkeeping,
  createTurnNotifier,
  createUsageAnchors,
  emptyCompletionNotice,
  isUserInterrupt,
  llmRetryNotice,
  resetUsageAnchors,
  turnStopLines,
} from './runner-loop.js';
import {
  approvalLabel,
  bottomStack,
  buildSplash,
  modeSelectRows,
  modeSelectedRow,
  nextModeIndex,
  clipToWidth,
  contextGaugeForms,
  contextLegend,
  humanTokens,
  layoutComposer,
  messageQueueRows,
  padDisplay,
  permissionLabel,
  REVEAL_TICK_MS,
  SPINNER_FRAMES,
  TOOL_GUTTER,
  toolArgSummary,
  toolLabel,
  type StopKind,
} from './ui.js';
import { buildApprovalPopup, buildCommandPopup, buildModelPopup, buildSessionPopup } from './popup.js';
import {
  agentRunBase,
  approvalEffectPreview,
  approvalNotifyBody,
  attachHooks,
  createApprovalService,
  createAutoCompact,
  persistMissingToolResults,
} from './runner-shared.js';
import { flattenBlocks, invalidateWraps, sliceHistory, wrapBlock } from './tui/frame.js';
import { TuiStore, type Block } from './tui/store.js';
import { handleKey as tuiHandleKey, type KeyEnv } from './tui/keys.js';
import { BgSubagentRows } from './tui/subagent-lives.js';
import { TurnProjector } from './tui/turn-projector.js';
import {
  CODE_MODE_HINT,
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
  /** --theme 覆盖 config 的 ui.theme。 */
  theme?: 'dark' | 'light' | 'plain';
}

// 仅剩 gutter 前缀的原始 ANSI（尾部开态样式是 wrapBlock 挂行契约，见下）。
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// 用户/答案行的 gutter 前缀：尾部保持开态样式（BOLD 未闭合、DIM 已复位）是
// wrapBlock 挂行契约的一部分，Palette 无"开而不闭"原语，故原始码留在壳层，
// 由 agentTurn（经 TurnProjector）与 switchToSession 回放共用同一份。
const USER_GUTTER = { first: `  ${CYAN}${BOLD}❯${RESET} ${BOLD}`, rest: `    ${BOLD}` };
const ASSISTANT_GUTTER = { first: `  ${DIM}•${RESET} `, rest: '    ' };

/** Composer prompt prefix; the cursor column math depends on its width. */
// （COMPOSER_PREFIX / 宽度基准已移至 ./composer.ts——换行预算与光标列数都在那边。）

export async function startTui(opts: TuiOptions): Promise<void> {
  const { config } = opts;
  // The live workspace: follows the session across /session switches.
  let rootDir = opts.rootDir;
  // 主题解析单源（tui-view.resolvePalette）：caps 表达 NO_COLOR/非 TTY/
  // COLORTERM；--theme 覆盖 config 的 ui.theme。dark=原配色平移，默认观感
  // 字节不变；/theme 可在运行中切换（NO_COLOR 下恒 plain）。
  const caps = detectCaps();
  let themeName: 'dark' | 'light' | 'plain' = opts.theme ?? config.ui?.theme ?? 'dark';
  let paint = resolvePalette(themeName, caps);
  const screen = new LineScreen(process.stdout, { synchronizedOutput: caps.synchronizedOutput });
  const decoder = new KeyDecoder();

  // ---- persistent state -------------------------------------------------
  // 会话按日期归档（codex 式）：~/.nova/sessions/YYYY/MM/DD/，全局不分项目；
  // 溢出缓存在 ~/.nova/cache/tool-outputs/<session-id>/（id 全局唯一）。
  // 工作区（运行 nova 的目录）零写入。
  let sessionsDir = newSessionDir();

  // Visibility for nested subagent runs: the runner owns the live row. The
  // callback closes over onSubagentProgressRef (routed into the turn
  // projector once it exists); it is a plain ref so late calls always reach
  // the current projector even though the wiring was fixed at session start.
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
  /** 站点模型目录缓存由 runtime 单源装配（/model 用）。 */
  const fetchModelList = rt.fetchModelList;
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

  // 执行模式：TUI 里 Tab 在新会话开始时循环 普通 → PTC → 混合。config 的
  // tools.code.mode 只是初始值（runtime 初始 host 已按它装配）；其余
  // tools.code 调参（超时/预算）在每次重建 host 时由 buildHost 原样带上。
  let codeMode: PtcMode = rt.codeConfig?.mode ?? 'native';
  let skills = rt.skills;
  // runtime 初始 host 已按 config 的 code.mode 装配（buildHost 单源），
  // 不再启动即弃用重建。
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
  // so the rebuild can reset them. 事件消费簿记（日志追加 + 锚点）单源在
  // runner-loop；tui/repl/exec/qqbot 同一契约。
  const anchors = createUsageAnchors();
  const bookkeeping = createRunnerBookkeeping({
    session: () => session,
    stats,
    anchors,
    messages: () => messages,
  });
  const turnNotifier = createTurnNotifier((title, body) => notify(title, body), {
    enabled: () => !exiting,
  });
  /**
   * Rebuild the plugin host for the current workspace + execution mode and
   * re-point `host`/`hooks` at it. Both the workspace switch and the Tab
   * mode toggle go through here: `host` is read live by runAgent (tools) and
   * `hooks` carries the beforeLLMCall projection that makes PTC mode visible,
   * so both must be re-derived from the SAME host on every rebuild. 装配本体
   * 在 runtime.buildHost（单源）；这里只接 runner 侧的 hooks 与呈现反馈。
   */
  const rebuildHost = async (): Promise<void> => {
    const next = await rt.buildHost({
      rootDir,
      codeMode,
      skills,
      // 模型在任务中要求换工作区时（switch_workspace 工具），走与 /session
      // 切换相同的 applyWorkspace 通道：工具根、技能、环境片段 cwd 一致重建。
      // applyWorkspace 在此处还未初始化——回调只在工具执行时触发，届时早已
      // 就绪。失败向上抛，工具结果如实回给模型。
      workspace: {
        onChange: async (dir: string) => {
          await applyWorkspace(dir);
          store.pushBlock([paint.dim(`  ✓ 工作区已切换到 ${dir}`)]);
          scheduleRender();
        },
      },
    });
    host = next;
    hooks = attachHooks(next, permission, rt.hooksRef);
    // The tool set changed: the usage anchor's implicit assumption (schema
    // bytes unchanged since the anchored request) is void. Reset so the next
    // pre-flight estimate takes the full-estimate path instead of a delta
    // repricing against a stale anchor (P2-7).
    resetUsageAnchors(anchors);
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
      void approvalEffectPreview(host, rootDir, call).then((lines) => {
        if (lines.length === 0) return;
        if (store.approval !== undefined && store.approval.call.id === call.id) {
          store.approvalPreview = lines.slice(0, APPROVAL_PREVIEW_MAX_ROWS);
          scheduleRender();
        }
      });
      store.scrollFromEnd = 0;
      notify('需要审批', approvalNotifyBody(call));
      scheduleRender();
    });
  const permission = createApprovalService(approvalMode, askApproval, () => session);
  // Reassigned by rebuildHost(): the agent loop must read hooks from the
  // SAME host instance it reads tools from (one rebuild = tools + projection).
  // runtime 初始 host 已按 config 的 code.mode 正确装配（buildHost 单源），
  // 无需启动即重建。
  // attachHooks 同时登记 runtime.hooksRef——此前 TUI 初始路径漏登记（只有
  // rebuildHost 才登记），开机后第一次 rebuild 之前嵌套 subagent 读不到父
  // 审批链、绕门执行工具。
  let hooks = attachHooks(host, permission, rt.hooksRef);
  const systemPrompt = rt.systemPrompt;

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

  const spinner = {
    start() {
      spinnerTimer ??= setInterval(() => {
        store.spinnerFrame += 1;
        // Animate the bullet of every running tool block (codex-style
        // activity marker): the elapsed/interrupt suffixes, live output tail
        // and the subagent live-row cycle are all projection — they live in
        // projector.animateRunningTools (./tui/turn-projector.ts).
        const frame = SPINNER_FRAMES[store.spinnerFrame % SPINNER_FRAMES.length] ?? '•';
        // 只在确有新增输出时推一个采样（门控在 TuiStore.sampleTps）——轮内的
        // 思考停顿 / 工具等待不推 0，否则连续几个 500ms 空窗会把 10 格窗口
        // 排空成"▁▁… 0"（用户看到的"偶尔清零"）。无新数据就只推进时钟、
        // 冻结窗口，速度表随真实产出左滚。
        store.sampleTps(Date.now());
        projector.animateRunningTools(frame);
        // Background delegations pick up their rows here while the parent
        // streams; after the turn ends the self-managed interval takes over.
        bgSubagentRows.sync();
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

  // ---- background subagent live rows --------------------------------------
  // run_in_background delegations have no pending tool line to take over and
  // no foreground progress feed: without their own rows they are invisible.
  // Poll/rewrite/self-tick cadence lives in BgSubagentRows (./tui/subagent-lives.ts).
  const bgSubagentRows = new BgSubagentRows({
    store,
    paint,
    jobs,
    now: () => Date.now(),
  });

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
   * Compact cancellation + progress (REPL parity): the summarizer request is
   * the slowest single request in the session (serialized whole transcript),
   * so it carries an AbortController the key chain can fire, and its wait line
   * ticks elapsed seconds — a silent dim line for minutes read as a freeze.
   */
  let compactAbort: AbortController | undefined;
  let compactCancelled = false;
  let compactBlock: Block | undefined;
  let compactStartedAt = 0;
  let compactTimer: NodeJS.Timeout | undefined;
  const endCompactWait = (): void => {
    if (compactTimer !== undefined) {
      clearInterval(compactTimer);
      compactTimer = undefined;
    }
    compactBlock = undefined;
  };
  const compactElapsedSecs = (): number => Math.max(1, Math.round((Date.now() - compactStartedAt) / 1000));
  const compactWaitLine = (mid: string): string =>
    `${paint.yellow(`  ⋯ ${mid}…`)} ${paint.dim(`· ${compactElapsedSecs()}s`)}`;
  const startCompactWait = (mid: string): void => {
    compactStartedAt = Date.now();
    compactBlock = store.pushBlock([compactWaitLine(mid)]);
    if (compactTimer !== undefined) clearInterval(compactTimer);
    compactTimer = setInterval(() => {
      // The summarizer streams like any LLM reply: sample the tps ring on the
      // same tick so a compacting session shows live speed, not a frozen meter.
      store.sampleTps(Date.now());
      const line = compactWaitLine(mid);
      if (compactBlock !== undefined && compactBlock.lines[0] !== line) {
        store.replaceBlock(compactBlock, [line]);
      }
      scheduleRender();
    }, 500);
  };

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
      anchors: () => anchors,
      resetAnchors: () => resetUsageAnchors(anchors),
      lastPromptTokens: () => anchors.lastPromptTokens,
      adoptSurface: (surface) => {
        messages = surface;
      },
    },
    compact: async (trigger) => {
      compactAbort = new AbortController();
      compactCancelled = false;
      try {
        return await compactSession({
          client,
          session,
          messages,
          trigger,
          signal: compactAbort.signal,
          // Summarizer output feeds the tps meter exactly like a streaming turn.
          onDelta: (text) => {
            store.tpsTokens += estimateTextTokens(text);
          },
        });
      } finally {
        compactAbort = undefined;
      }
    },
    report: {
      preStart: (limit) => startCompactWait(`预估下轮上下文超阈值 ${humanTokens(limit)}`),
      postStart: (tokens) => startCompactWait(`上下文 ${humanTokens(tokens)} tok 超阈值，正在压缩`),
      success: (outcome) => {
        endCompactWait();
        store.pushBlock([
          `${paint.green('  ✓ 已压缩')} ${paint.dim(`· 摘要 ${outcome.summary.length} 字 · 保留 ${outcome.retained} 条最近消息 · ${compactElapsedSecs()}s`)}`,
        ]);
      },
      failure: (err, where) => {
        endCompactWait();
        if (compactCancelled) {
          store.pushBlock([paint.yellow('  ■ 已取消压缩')], TOOL_GUTTER);
          return;
        }
        store.pushBlock(
          [paint.red(`  ✗ ${where === 'pre' ? '预压缩' : '自动压缩'}失败：${errMessage(err)}`)],
          TOOL_GUTTER,
        );
      },
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

  // ---- turn projector ----------------------------------------------------
  // The per-turn transcript state machine (stream smoothing, assistant/
  // reasoning block lifecycle, tool-line morphs, subagent live rows, abort/
  // error teardown) lives in ./tui/turn-projector.ts; the shell keeps only
  // timers, terminal IO and the agent-loop plumbing. Reveal pacing is armed
  // through a turn-local slot — the projector never owns setInterval.
  let revealEnsurer: () => void = () => undefined;
  const projector = new TurnProjector({
    store,
    paint,
    cols: () => screen.cols,
    now: () => Date.now(),
    onNeedsReveal: () => revealEnsurer(),
    gutters: { user: USER_GUTTER, assistant: ASSISTANT_GUTTER },
  });
  // The runtime wiring (createSessionRuntime / bashPluginArgs) predates any
  // turn, so the nested progress feed goes through this ref — now a constant
  // route into the projector, which pins the foreground subagent call itself.
  const onSubagentProgressRef: { current: (progress: SubagentProgress) => void } = {
    current: () => undefined,
  };
  onSubagentProgressRef.current = (progress) => projector.subagentProgress(progress);

  async function agentTurn(userInput: string): Promise<void> {
    await commitUserMessage(session, messages, userInput);
    // Spacing (Codex cell contract): store.blocks carry no manual separators —
    // flattenBlocks inserts the single blank row between non-empty store.blocks.
    projector.beginTurn(userInput);

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

    // ---- steady-tick reveal (typewriter) --------------------------------
    // The projector queues both streams; this turn-owned ticker drains them on
    // a steady cadence and parks itself once nothing is pending (the next
    // delta re-arms it through onNeedsReveal). Turn end always parks it.
    let revealTimer: NodeJS.Timeout | undefined;
    const stopReveal = (): void => {
      if (revealTimer !== undefined) {
        clearInterval(revealTimer);
        revealTimer = undefined;
      }
    };
    revealEnsurer = (): void => {
      revealTimer ??= setInterval(() => {
        projector.tick();
        if (!projector.hasPendingReveal()) stopReveal();
        scheduleRender();
      }, REVEAL_TICK_MS);
    };
    try {
      for await (const event of runAgent({
        ...agentRun(),
        // Live bash output lands in the running tool block's tail buffer; the
        // spinner tick renders it (never a render per chunk).
        onToolProgress: (text) => projector.toolTail(text),
        signal: aborter.signal,
      })) {
        await onAgentEvent(event, startedAt);
      }
    } catch (err) {
      spinner.stop();
      // Repair the log before any surface work: the turn may have died with
      // assistant tool_calls unanswered — append synthesized results (same
      // copy core's abandonment synthesis uses) so the log keeps its
      // one-result-per-call contract.
      await persistMissingToolResults(session, messages).catch(() => undefined);
      const message = errMessage(err);
      // Classify by OUR signal (runner-loop.isUserInterrupt), never by the
      // error's wording: undici and gateways throw "The operation was aborted
      // due to timeout" on plain network stalls — labeling those 已中断 hid
      // the real error (and the retry hint) behind a silent interrupt.
      if (isUserInterrupt(aborter.signal)) {
        // 半截未提交的回答块、未揭示文本与「■ 已中断」行收在投影器里。
        projector.handleFailure('abort');
      } else {
        // 同上，另落「已丢弃」提示行与错误行；长任务出错补一个 toast。
        projector.handleFailure('error', message);
        turnNotifier.error(startedAt, message);
      }
    } finally {
      const idx = aborters.indexOf(aborter);
      if (idx >= 0) aborters.splice(idx, 1);
      spinner.stop();
      // Park the ticker and detach the arm slot: an aborted turn reveals
      // nothing more, and a late delta from a discarded run must not re-arm.
      stopReveal();
      revealEnsurer = () => undefined;
      // 清场收进投影器：flags、假活行回退、思考尾行、未揭示文本、读组——
      // 原先手撒在 catch 与 finally 两处的序列现在只有一个入口。
      projector.endTurn();
      // Runtime invariant (NOVA_DEBUG): the live surface must stay equal to
      // the session log projection — "model-visible means logged".
      if (process.env['NOVA_DEBUG'] !== undefined) {
        const divergence = surfaceDivergence(session, messages);
        if (divergence !== undefined) store.pushBlock([paint.red(`  [invariant] ${divergence}`)]);
      }
      // Long turns end while the user is elsewhere: the toast is the "come
      // back, it's done" cue (short turns stay silent — that's just spam).
      turnNotifier.done(startedAt);
      scheduleRender();
    }
    await maybeAutoCompact();
    // 运行中排队的消息在此刻接续下发（自动压缩先走，避免新轮踩在压缩途中）。
    drainMessageQueue();
    scheduleRender();
  }

  async function onAgentEvent(event: AgentEvent, startedAt: number): Promise<void> {
    switch (event.type) {
      case 'turn_start':
        break;
      case 'llm_retry': {
        // The provider dropped the response mid-stream and is re-requesting:
        // discard the partial answer, adopt the corrected stats, and leave a
        // dim audit line. The failed attempt's usage stays a valid anchor —
        // the retry sends the same prompt prefix.
        Object.assign(stats, event.stats);
        projector.resetAssistant();
        store.genPhase = 'thinking'; // 重新请求在途，属于"生成中"
        store.pushBlock([paint.dim(`  ⟳ ${llmRetryNotice(event.error, event.attempt, event.maxRetries)}`)], TOOL_GUTTER);
        break;
      }
      case 'empty_completion': {
        // The model "finished" with no text and no tool calls — everything
        // went into the thinking stream. Previously this ended the run in
        // silence; now the loop re-issues, and this line explains why the
        // thinking appears to restart.
        projector.resetAssistant();
        store.genPhase = 'thinking';
        store.pushBlock(
          [paint.dim(`  ⟳ ${emptyCompletionNotice(event.finishReason, event.attempt, event.maxRetries)}`)],
          TOOL_GUTTER,
        );
        break;
      }
      case 'text_delta':
        // Empty deltas do nothing: the assistant opens lazily on the first
        // non-blank delta, so reasoning phase is never reset by padding.
        if (event.text.length === 0) break;
        projector.appendAssistant(event.text);
        break;
      case 'reasoning_delta':
        projector.appendReasoning(event.text);
        break;
      case 'message': {
        projector.closeAssistant();
        // Append EVERY assistant message, including content-less pure
        // tool-call turns: the log must mirror the model surface ("model
        // visible means logged"), or resume/compact projects orphan tool
        // results with no matching tool_calls. 簿记单源在 runner-loop。
        await bookkeeping.apply(event);
        break;
      }
      case 'tool_call_start': {
        // 折叠思考尾行、genPhase、只读分组收尾、前台子代理的进度路由、待定行
        // 块与 toolBlocks 登记——投影全部在 projector.toolStart 里。
        projector.toolStart(event.call);
        break;
      }
      case 'tool_call_result': {
        await bookkeeping.apply(event);
        // A "Started background subagent …" result lands here: pin its live
        // row immediately instead of waiting for the next spinner tick.
        bgSubagentRows.sync();
        // 完成行/只读分组归并/子代理活行收编——投影在 projector.toolResult。
        projector.toolResult(event.call, event.result.content);
        break;
      }
      case 'usage':
        await bookkeeping.apply(event);
        scheduleRender();
        break;
      case 'turn_aborted':
        await bookkeeping.apply(event);
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
        projector.foldReasoning();
        // A normal completion ends at the reply — no per-turn stats line (the
        // status bar carries tokens; /session carries details). Only abnormal
        // stops get a visible marker.
        if (event.stopReason !== 'complete') {
          const kind: StopKind = event.stopReason;
          store.pushBlock(turnStopLines(paint, kind, stats, Date.now() - startedAt, config));
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
      paint.dim(`  执行模式只能在对话开始前切换（当前 ${codeModeLabel(codeMode)}，/mode 查看说明）`),
    ]);
  };

  /**
   * 芯片呈现的"未开始"判据：三枚芯片并排仅在会话未开始时展示。
   */
  const displayPristine = (): boolean =>
    !store.streaming && !store.compactRunning && messages.length <= 1 && store.input.length === 0;

  /** Switch to a concrete mode; false = refused (Node too old) or failed (host rebuild). */
  async function setCodeMode(next: PtcMode): Promise<boolean> {
    if (next !== 'native' && !codeRuntimeAvailable()) {
      store.pushBlock([
        paint.yellow(`  ${codeModeLabel(next)}模式需要 Node ≥ 22.19（当前 ${process.version} 不支持类型剥离）`),
      ]);
      return false;
    }
    store.modeSwitching = true;
    const prev = codeMode;
    codeMode = next;
    scheduleRender();
    try {
      await rebuildHost();
      // 切换反馈：不依赖状态栏芯片也能看到（会话中途芯片塌成单枚，
      // 且 pristine 判据会随首条消息失效——没有这行用户以为 Tab 失灵）。
      // 开屏选择器的确认不推这行——选择块原位塌缩成确认行，不重复。
      if (store.modeSelect === undefined) {
        store.pushBlock([paint.dim(`  执行模式：${codeModeLabel(prev)} → ${codeModeLabel(next)}`)]);
      }
      return true;
    } catch (err) {
      // activate() 在 next host 上抛错：host/hooks 还没换，回滚模式即可。
      codeMode = prev;
      store.pushBlock([
        paint.red(`  ✗ 模式切换失败：${errMessage(err)}`),
        paint.dim(`  已保持${codeModeLabel(prev)}模式`),
      ]);
      return false;
    } finally {
      store.modeSwitching = false;
      scheduleRender();
    }
  }

  async function toggleCodeMode(): Promise<void> {
    const order: PtcMode[] = ['native', 'ptc', 'both'];
    const next = order[(order.indexOf(codeMode) + 1) % order.length] ?? 'native';
    await setCodeMode(next);
  }

  // ---- startup mode selector ----------------------------------------------
  // The splash renders an interactive execution-mode block; keys.ts consumes
  // ↑↓/Enter/Esc while store.modeSelect is set. Collapse = in-place rewrite
  // of the selector block (never a leftover interactive frame in the log).
  let modeSelectBlock: Block | undefined;
  const CODE_MODE_ORDER: PtcMode[] = ['native', 'ptc', 'both'];
  const selectorAlive = (): boolean => modeSelectBlock !== undefined && store.blocks.includes(modeSelectBlock);
  const rerenderModeSelect = (): void => {
    if (!selectorAlive() || store.modeSelect === undefined) return;
    store.replaceBlock(
      modeSelectBlock!,
      modeSelectRows(paint, { index: store.modeSelect.index, ptcAvailable: codeRuntimeAvailable(), cols: screen.cols }),
    );
  };
  const collapseModeSelect = (): void => {
    if (store.modeSelect === undefined) return;
    store.modeSelect = undefined;
    if (selectorAlive()) {
      store.replaceBlock(modeSelectBlock!, [modeSelectedRow(paint, codeMode, screen.cols)]);
    }
    modeSelectBlock = undefined;
  };
  const modeSelectMove = (delta: number): void => {
    if (store.modeSelect === undefined) return;
    store.modeSelect.index = nextModeIndex(store.modeSelect.index, delta, codeRuntimeAvailable());
    rerenderModeSelect();
  };
  const modeSelectConfirm = async (index?: number): Promise<void> => {
    if (store.modeSelect === undefined) return;
    const next = CODE_MODE_ORDER[index ?? store.modeSelect.index] ?? codeMode;
    if (next !== codeMode) {
      const ok = await setCodeMode(next);
      if (!ok) {
        // warning line already pushed; selector stays for another pick
        rerenderModeSelect();
        return;
      }
    }
    collapseModeSelect();
    scheduleRender();
  };
  const modeSelectDismiss = (): void => {
    collapseModeSelect();
    scheduleRender();
  };

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
        const lines = COMMAND_SPECS.map((spec) => paint.dim(`  ${padDisplay(spec.usage, 24)}${spec.description}`));
        store.pushBlock([`  ${paint.bold('命令')}`, ...lines]);
        return true;
      }
      case '/model': {
        try {
          const models = await fetchModelList();
          if (models.length === 0) {
            store.pushBlock([paint.dim(`  ${MODEL_LIST_EMPTY}`)]);
          } else {
            // Interactive picker overlay (↑↓ Enter Esc), not a history dump.
            const current = models.indexOf(client.model);
            store.modelPicker = { models, index: Math.max(0, current) };
            scheduleRender();
          }
        } catch (err) {
          store.pushBlock([paint.red(`  ${modelListError(err)}`)]);
        }
        return true;
      }
      case '/approvals': {
        const next = nextApprovalMode(permission.approvalMode);
        permission.setMode(next as ApprovalMode);
        store.pushBlock([paint.dim(`  审批档位：${approvalLabel(next)}`)]);
        return true;
      }
      case '/mode': {
        store.pushBlock([
          `  ${paint.bold('执行模式')} ${paint.dim('· 仅对话开始前可按 Tab 循环切换')}`,
          ...(['native', 'ptc', 'both'] as PtcMode[]).map((m) =>
            m === codeMode
              ? `  ${paint.cyan(paint.bold(`❯ ${padDisplay(codeModeLabel(m), 6)}`))} ${CODE_MODE_HINT[m]}`
              : `    ${padDisplay(codeModeLabel(m), 6)} ${paint.dim(CODE_MODE_HINT[m])}`,
          ),
          paint.dim('  模式决定工具集呈现方式；切换立即生效（usage 锚点自动重置）'),
        ]);
        return true;
      }
      case '/theme': {
        // 无参数：列出三主题并标当前。带参数：即时切换（screen.invalidate
        // 全屏重绘，配置只作下次启动的持久值，不回写 config.json）。
        const arg = raw.trim().split(/\s+/)[1];
        if (arg === undefined) {
          store.pushBlock([
            `  ${paint.bold('主题')} ${paint.dim('· /theme dark|light|plain 切换（NO_COLOR 恒定无色）')}`,
            ...(['dark', 'light', 'plain'] as const).map((name) =>
              name === themeName
                ? `  ${paint.cyan(paint.bold(`❯ ${name}`))}`
                : `    ${paint.dim(name)}`,
            ),
          ]);
          return true;
        }
        if (arg !== 'dark' && arg !== 'light' && arg !== 'plain') {
          store.pushBlock([paint.red(`  ✗ 未知主题：${arg}（可选 dark / light / plain）`)]);
          return true;
        }
        themeName = arg;
        paint = resolvePalette(arg, caps);
        screen.invalidate();
        store.pushBlock([paint.dim(`  主题已切换为 ${arg}`)]);
        return true;
      }
      case '/plugins': {
        // 与 repl 同一信息量（审批档位 + 命令注册项此前只在 repl 有）。
        store.pushBlock([
          `  ${paint.bold('插件与工具')}${paint.dim(
            ` · 审批档位 ${approvalLabel(permission.approvalMode)}${opts.approvalOverride !== undefined ? '（来自 --approval）' : ''}`,
          )}`,
          ...(host.toolEntries.length === 0
            ? [paint.dim('  （没有已注册的工具）')]
            : host.toolEntries.map((entry) =>
                paint.dim(`  ${pluginToolLine(entry.plugin, entry.tool.name, permissionLabel(entry.permission))}`),
              )),
          ...host.commandEntries.map((entry) =>
            paint.dim(`  ${pluginCommandLine(entry.plugin, entry.command.name, entry.command.description)}`),
          ),
        ]);
        return true;
      }
      case '/session': {
        const hit = cacheHitPct(stats.promptTokens, stats.cachedTokens);
        const lastHit = lastCacheHitPct(anchors.lastUsage);
        const compact = config.autoCompactTokenLimit
          ? `阈值 ${humanTokens(config.autoCompactTokenLimit)} tok · 上轮 ${humanTokens(anchors.lastPromptTokens)} tok`
          : '未启用';
        store.pushBlock([
          `  ${paint.bold('会话')}${paint.dim(` · nova v${cliVersion()} · 模式 ${codeModeLabel(codeMode)}`)}`,
          paint.dim(`  文件 ${session.file}`),
          paint.dim(`  消息 ${messages.length} 条 · 日志事件 ${session.events.length} 条 · ${stats.turns} 轮`),
          paint.dim(`  输入 ${stats.promptTokens} tok（缓存 ${hit}%${lastHit !== null ? ` · 上轮 ${lastHit}%` : ''}）· 输出 ${stats.completionTokens} tok`),
          paint.dim(`  缓存浪费 ${stats.missTokens} tok · 超噪声底轮次 ${stats.missTurns}`),
          paint.dim(`  自动压缩 ${compact}`),
          `  ${paint.bold('模型')} ${client.model}`,
          currentModelMeta !== undefined
            ? paint.dim(`  ${formatModelMeta(currentModelMeta)}（models.dev · ${currentModelMeta.provider}）`)
            : paint.dim('  元数据未命中（离线或目录没有该模型；可配 provider.contextWindow 兜底）'),
          paint.dim(`  ${contextLegend(paint, contextBreakdown(contextView()).segments.filter((s) => s.tokens > 0))}`),
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
          store.pushBlock([paint.red(`  ✗ 会话列表读取失败：${errMessage(err)}`)]);
        }
        return true;
      }
      case '/new': {
        sessionsDir = newSessionDir(); // 跨天运行时归入当天的日期桶
        ({ session, messages } = await openFreshSession({
          sessionsDir,
          rootDir,
          setClientSessionId: (id) => client.setSessionId(id),
          stats,
          anchors,
          resetSessionCache,
          recordWorkspace: recordSessionWorkspace,
          seedContext: seedContextFragment,
        }));
        store.pushBlock([paint.dim(`  新会话：${session.file}`)]);
        return true;
      }
      case '/compact': {
        startCompactWait('正在压缩会话');
        try {
          const outcome = await runCompact('manual');
          endCompactWait();
          store.pushBlock([
            `${paint.green('  ✓ 已压缩')} ${paint.dim(`· 摘要 ${outcome.summary.length} 字 · 保留 ${outcome.retained} 条最近消息 · ${compactElapsedSecs()}s`)}`,
          ]);
        } catch (err) {
          endCompactWait();
          if (compactCancelled) {
            store.pushBlock([paint.yellow('  ■ 已取消压缩')], TOOL_GUTTER);
          } else {
            store.pushBlock([paint.red(`  ✗ 压缩失败：${errMessage(err)}`)], TOOL_GUTTER);
          }
        }
        return true;
      }
      case '/clear': {
        bgSubagentRows.clear();
        modeSelectBlock = undefined;
        store.modeSelect = undefined;
        store.clearView();
        store.pushBlock([paint.dim('  （已清空显示，会话记录保留在磁盘）')]);
        return true;
      }
      case '/init': {
        const file = await writeAgentsMd(rootDir);
        store.pushBlock([paint.green(`  已写入 ${path.basename(file)}`)]);
        return true;
      }
      default:
        store.pushBlock([`${paint.red(`  未知命令：${cmd}`)} ${paint.dim('（输入 /help 查看命令）')}`]);
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
      store.pushBlock([paint.yellow('  当前轮未结束：先 Esc 中断，再切换会话')]);
      scheduleRender();
      return;
    }
    let loaded: Session;
    try {
      loaded = await Session.open(entry.file);
    } catch (err) {
      store.pushBlock([paint.red(`  ✗ 会话读取失败：${errMessage(err)}`)]);
      scheduleRender();
      return;
    }
    const restored = loaded.deriveMessages();
    session = loaded;
    messages = restored;
    // Corruption tolerance reported at open: surface it like the REPL does —
    // a skipped damaged row or a repaired tail is worth knowing about.
    for (const warning of loaded.warnings) {
      store.pushBlock([paint.yellow(`  ⚠ ${warning}`)]);
    }
    // Rebind the cache-affinity identity and drop the old usage anchor (same
    // reasoning as /new): the restored history changes the prompt prefix, so
    // the next turn rebuilds the cache instead of tripping a spurious compact.
    client.setSessionId(loaded.id);
    Object.assign(stats, emptyStats());
    resetUsageAnchors(anchors);
    resetSessionCache();
    bgSubagentRows.clear();
    modeSelectBlock = undefined;
    store.modeSelect = undefined;
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
      workspaceLine = `${paint.yellow(`  ⚠ 会话记录的工作区指向 nova 数据目录（${target}），已忽略`)} ${paint.dim(`（工具保持 ${rootDir}）`)}`;
    } else if (target !== undefined && target !== rootDir) {
      if (existsSync(target)) {
        await applyWorkspace(target);
        workspaceLine = `${paint.green('  ✓ 工作区已切换')} ${paint.dim(target)}`;
      } else {
        workspaceLine = `${paint.yellow(`  ⚠ 原工作区已不存在：${target}`)} ${paint.dim(`（工具仍指向 ${rootDir}）`)}`;
      }
    }
    const userVisible = restored.filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0 && !m.content.trimStart().startsWith('<'),
    );
    if (userVisible.length === 0 && restored.length > 0) {
      store.pushBlock([
        paint.dim(`  （该会话没有可回放的文本消息——可能被压缩投影或日志损坏截去；消息共 ${restored.length} 条）`),
      ]);
    }
    for (const m of restored) {
      if (m.role === 'user') {
        if (m.content.trimStart().startsWith('<')) continue;
        store.pushBlock([m.content], USER_GUTTER, 'user');
      } else if (m.role === 'assistant' && m.content.trim().length > 0) {
        // 与流式轮同一 markdown 渲染（bold/标题/列表/围栏），否则同一回答
        // 实时看是渲染版、/session 切回来是裸 markdown。
        store.pushBlock(renderMarkdownLite(m.content, paint), ASSISTANT_GUTTER, 'assistant');
      }
    }
    store.pushBlock([
      `${paint.green('  ✓ 已切换到会话')} ${paint.dim(`${path.basename(loaded.file)} · 上下文 ${restored.length} 条消息`)}`,
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
    // First submit ends the startup selector: the picked (or current) mode is
    // what this first message runs under — collapse to the confirmation row.
    collapseModeSelect();
    if (store.streaming || store.compactRunning) {
      const cmd = text.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (STREAM_SAFE_COMMANDS.has(cmd)) {
        store.input = '';
        store.cursorPos = 0;
        store.popupIndex = 0;
        void runCommand(text)
          .catch((err: unknown) => {
            store.pushBlock([paint.red(`  ✗ 命令失败：${errMessage(err)}`)]);
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
        if (store.historyStack.length > HISTORY_LIMIT) store.historyStack.shift();
        store.enqueueMessage(text);
        store.pushBlock([paint.dim('  ┃ 已排队 · 本轮结束后自动发送（Esc 可中断当前轮）')]);
        scheduleRender();
        return;
      }
      store.pushBlock([
        paint.dim('  上一轮仍在进行：正文将排队在本轮结束后发送；/approvals /model /session /plugins 等查看类命令仍可用'),
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
    if (store.historyStack.length > HISTORY_LIMIT) store.historyStack.shift();
    await dispatchUserText(text);
  }

  /** 技能展开 + 命令分发 + agentTurn 启动：handleSubmit 与队列下发共用。 */
  async function dispatchUserText(text: string): Promise<void> {
    let effective = text;
    const skillInvocation = await expandSkillInvocation(effective, skills);
    if (skillInvocation !== undefined) {
      if (!skillInvocation.ok) {
        store.pushBlock([paint.red(`  ${skillInvocation.error}`)]);
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
          store.pushBlock([paint.red(`  ✗ 命令失败：${errMessage(err)}`)]);
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
      store.pushBlock([paint.red(`  ✗ 本轮失败：${errMessage(err)}`)], TOOL_GUTTER);
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
    abortCompact: () => {
      compactCancelled = true;
      compactAbort?.abort();
    },
    modeSelectMove,
    modeSelectConfirm: (index) => void modeSelectConfirm(index),
    modeSelectDismiss,
    exitApp,
    scheduleRender,
    preemptRender,
    submit: () => void handleSubmit(),
    toggleCodeMode: () => void toggleCodeMode(),
    canSwitchMode,
    noteModeSwitchBlocked,
    switchModel: (model) => {
      client.setModel(model);
      store.pushBlock([paint.dim(`  模型已切换为 ${model}`)]);
      void refreshModelMeta();
    },
    switchSessionFile: (file) => void switchToSession({ file }),
    currentModel: () => client.model,
    currentSessionFile: () => session.file,
    refreshModelMeta: () => void refreshModelMeta(),
    popupMatches: () => commandPopupMatches(),
    totalWrappedLines,
    notice: (lines) => store.pushBlock(lines.map((l) => paint.dim(l))),
  };

  function handleKey(k: Key): void {
    tuiHandleKey(keyEnv, k);
  }


  // ---- rendering --------------------------------------------------------
  let cachedFlatten:
    | { cols: number; version: number; result: { flat: string[]; rowMap: { block: Block; start: number; count: number }[] } }
    | undefined;

  /** 上一帧展平后的总行数（滚动锚定的增量基准；-1 = 尚无帧）。 */
  let lastFlatLen = -1;
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
    // 滚动锚定（stick-to-content）：用户上滚后（scrollFromEnd>0）新输出
    // 不再把视口往直播拽——按上一帧以来的新增行数等量增大 offset，把视口
    // 钉在用户当时看的绝对位置；回到底部（offset 归 0）后恢复跟随。
    if (store.scrollFromEnd > 0 && lastFlatLen >= 0 && flat.length > lastFlatLen) {
      store.scrollFromEnd += flat.length - lastFlatLen;
    }
    lastFlatLen = flat.length;
    const historyBudget = rows - popupLines.length - queueLines.length - composerZoneRows.length - STATUS_ROWS - BREATHE_ROWS;
    const { lines: historyLines, sliceStart, maxScroll } = sliceHistory(flat, historyBudget, store.scrollFromEnd);
    if (store.scrollFromEnd > maxScroll) store.scrollFromEnd = maxScroll;
    store.frameMap = { rows: rowMap, sliceStart, historyRows: historyLines.length };

    // 按显示宽裁剪：绝不折行顶动布局（statusBar 内部已做截左保右）。
    const status = clipToWidth(statusBar(paint, statusView()), cols - 1);

    // 位置指示：上滚时呼吸行改为「上方还有 N 行」（回底自动消失；不占内容行、
    // 不进状态栏——上滚不进状态栏是 tui-design 红线）。
    const breathText =
      sliceStart > 0
        ? clipToWidth(paint.dim(`  ⋯ 上方还有 ${sliceStart} 行 · Home 跳顶 / End 回到底部`), cols - 1)
        : '';

    screen.render(
      bottomStack(historyLines, popupLines, queueLines, composerZoneRows, status, breathText),
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
    usageAnchor: anchors.usageAnchor,
    anchorMsgCount: anchors.anchorMsgCount,
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
      usageAnchor: anchors.usageAnchor,
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
    bgSubagentRows.stop();
    endCompactWait();
    compactAbort?.abort();
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
  /**
   * Lone-ESC disambiguation window. ConPTY (Windows) regularly splits an
   * escape sequence between the ESC and its body across reads; 32ms flushed
   * the head as an Esc KEYSTROKE, and Esc aborts a running turn — the
   * phantom interrupt. 200ms still feels instant for a real Esc press while
   * tolerating a slow split.
   */
  const ESC_FLUSH_MS = 200;
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
      }, ESC_FLUSH_MS);
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
  // Startup mode selector: an interactive block the key chain owns until the
  // user confirms, keeps the current mode, or simply starts typing.
  modeSelectBlock = store.pushBlock(
    modeSelectRows(paint, {
      index: Math.max(0, CODE_MODE_ORDER.indexOf(codeMode)),
      ptcAvailable: codeRuntimeAvailable(),
      cols: screen.cols,
    }),
  );
  store.modeSelect = { index: Math.max(0, CODE_MODE_ORDER.indexOf(codeMode)) };

  await new Promise<void>((resolve) => {
    exitNow = resolve;
  });
  console.log(`会话已保存：${session.file}`);
}
