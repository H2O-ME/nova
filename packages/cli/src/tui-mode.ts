import { existsSync } from 'node:fs';
import path from 'node:path';
import { KeyDecoder, LineScreen, detectCaps, type Key } from '@nova-agent/tui';
import {
  APPROVAL_PREVIEW_MAX_ROWS,
  HISTORY_LIMIT,
  RENDER_BUDGET_MS,
  SESSION_LIST_LIMIT,
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
import { filterCommands, type CommandSpec } from './commands.js';
import { openFreshSession, type ThemeName } from './command-core.js';
import { newSessionDir, novaHome, sessionsRoot, type Config } from './config.js';
import { expandSkillInvocation, type SessionEnvInfo } from './context.js';
import { createNotifier } from './notify.js';
import { createModelMetaStore, type ModelMeta } from './model-meta.js';
import { listRecentSessions, recordSessionWorkspace, sessionWorkspace } from './sessions.js';
import { createSessionRuntime } from './session-runtime.js';
import {
  classifyTurnFailure,
  commitUserMessage,
  createRunnerBookkeeping,
  createTurnNotifier,
  createUsageAnchors,
  resetUsageAnchors,
} from './runner-loop.js';
import { buildSplash, contextLegend, humanTokens, REVEAL_TICK_MS, SPINNER_FRAMES, TOOL_GUTTER } from '@nova-agent/tui-view';
import { TuiCommands } from './tui/commands.js';
import { CompactWait } from './tui/compact-wait.js';
import { FrameAssembler } from './tui/frame-assembler.js';
import { ASSISTANT_GUTTER, USER_GUTTER } from './tui/gutters.js';
import { CODE_MODE_ORDER, ModeSelector } from './tui/mode-select.js';
import { switchSessionTo } from './tui/session-switch.js';
import {
  agentRunBase,
  approvalEffectPreview,
  approvalNotifyBody,
  attachHooks,
  createApprovalService,
  createAutoCompact,
} from './runner-shared.js';
import { invalidateWraps, resolveActiveView, wrapBlock } from './tui/frame.js';
import { TuiStore } from './tui/store.js';
import { handleKey as tuiHandleKey, type KeyEnv } from './tui/keys.js';
import { BgSubagentRows } from './tui/subagent-lives.js';
import { TurnProjector } from './tui/turn-projector.js';
import { codeModeLabel, contextBreakdown, type ContextBreakdownView, type StatusView } from '@nova-agent/tui-view';
import { cliVersion } from './version.js';

export interface TuiOptions {
  rootDir: string;
  config: Config;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
  /** --theme 覆盖 config 的 ui.theme。 */
  theme?: ThemeName;
}

// 用户/答案行的 gutter 前缀（开态原始 ANSI 的挂行契约）出壳 ./tui/gutters.ts。

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
  let themeName: ThemeName = opts.theme ?? config.ui?.theme ?? 'dark';
  let paint = resolvePalette(themeName, caps);
  // 背压门（R3）：drain 后重排一帧——被丢的帧不进差分缓存，恢复首帧自然
  // 从旧真相 diff 到最新画面（latest-wins）。scheduleRender 在下方声明，走闭包延后取。
  const screen = new LineScreen(process.stdout, {
    synchronizedOutput: caps.synchronizedOutput,
    onDrain: () => scheduleRender(),
  });
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
  // 类型由 rt 推断（AgentMessage[]；显式 type-only 注解会踩 oxlint 非 type-aware 规则）。
  let messages = rt.messages;
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
      store.approvalScope = 1;
      store.approvalNote = '';
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
   * 状态机在 ./tui/compact-wait.ts；真表在这里注入（类不碰 setInterval）。
   */
  const compactWait = new CompactWait({
    store,
    paint: () => paint,
    now: () => Date.now(),
    render: scheduleRender,
    every: (fn) => {
      // 摘要与普通流式轮同一口径喂 tps 速度表：tick 先采样再刷等待行。
      const timer = setInterval(() => {
        store.sampleTps(Date.now());
        fn();
      }, 500);
      return () => clearInterval(timer);
    },
  });

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
      const aborter = compactWait.beginRequest();
      try {
        return await compactSession({
          client,
          session,
          messages,
          trigger,
          signal: aborter.signal,
          // Summarizer output feeds the tps meter exactly like a streaming turn.
          onDelta: (text) => {
            store.tpsTokens += estimateTextTokens(text);
          },
        });
      } finally {
        compactWait.endRequest();
      }
    },
    report: {
      preStart: (limit) => compactWait.start(`预估下轮上下文超阈值 ${humanTokens(limit)}`),
      postStart: (tokens) => compactWait.start(`上下文 ${humanTokens(tokens)} tok 超阈值，正在压缩`),
      success: (outcome) => {
        compactWait.end();
        store.pushBlock([compactWait.doneLine(outcome)]);
      },
      failure: (err, where) => {
        compactWait.end();
        if (compactWait.wasCancelled()) {
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
    // 活调色板：/theme 运行中重绑 paint，投影器推的呈现行必须用当前值。
    livePaint: () => paint,
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
      // 修日志+归类单源（runner-loop.classifyTurnFailure）：按本轮 signal
      // 是否真的触发，绝不看错误文案——网络停摆的 "aborted" 必须亮出原文。
      const fail = await classifyTurnFailure(session, messages, err, aborter.signal);
      if (fail.kind === 'interrupt') {
        // 半截未提交的回答块、未揭示文本与「■ 已中断」行收在投影器里。
        projector.handleFailure('abort');
      } else {
        // 同上，另落「已丢弃」提示行与错误行；长任务出错补一个 toast。
        projector.handleFailure('error', fail.message);
        turnNotifier.error(startedAt, fail.message);
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

  /**
   * 事件消费：呈现归约在投影器（projector.onEvent，阶段 E 出壳），壳层只补
   * 簿记（日志/usage/锚点，runner-loop 单源）与 shell 态（spinner、会话缓存
   * 累计、重绘、后台子代理钉行）。
   */
  async function onAgentEvent(event: AgentEvent, startedAt: number): Promise<void> {
    // 重试携带修正后的 usage：先合并，投影器的审计行与后续 done 都读它。
    if (event.type === 'llm_retry') Object.assign(stats, event.stats);
    projector.onEvent(event, { stats, elapsedMs: Date.now() - startedAt, config });
    await bookkeeping.apply(event);
    switch (event.type) {
      case 'tool_call_result':
        // A "Started background subagent …" result lands here: pin its live
        // row immediately instead of waiting for the next spinner tick.
        bgSubagentRows.sync();
        return;
      case 'usage':
        scheduleRender();
        return;
      case 'done':
        spinner.stop();
        // 累计本会话真实用量（此刻 stats = 本轮 runAgent 的累计）。done 每用户
        // 轮只触发一次，故按轮累加不会重复计同一 LLM 调用。见过缓存上报即置
        // cacheSeen——之后状态栏 cache 段常驻，不随某轮后端未返回而闪现。
        sessPromptTokens += stats.promptTokens;
        sessCachedTokens += stats.cachedTokens;
        if (stats.cachedTokens > 0) cacheSeen = true;
        return;
      default:
        return;
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
    const next = CODE_MODE_ORDER[(CODE_MODE_ORDER.indexOf(codeMode) + 1) % CODE_MODE_ORDER.length] ?? 'native';
    await setCodeMode(next);
  }

  // ---- startup mode selector ----------------------------------------------
  // 选择块状态机出壳 ./tui/mode-select.ts（阶段 E）：块引用、↑↓/Enter/Esc
  // 语义与原位塌缩都在类里；setCodeMode 与 Tab 共用同一个门。
  const modeSelector = new ModeSelector({
    store,
    paint: () => paint,
    cols: () => screen.cols,
    codeMode: () => codeMode,
    setCodeMode: (next) => setCodeMode(next),
    render: scheduleRender,
  });

  // ---- commands ---------------------------------------------------------
  /**
   * 命令呈现层出壳到 ./tui/commands.ts（阶段 E）：行公式与正文在 command-core
   * 单源，这里只剩壳层状态的访问器接线与编排（/new 序列、压缩等待、清场）。
   * paint/session/messages 等可变绑一律走闭包访问器——值捕获会拿旧引用。
   */
  const commands = new TuiCommands({
    store,
    paint: () => paint,
    render: scheduleRender,
    permission,
    approvalOverride: opts.approvalOverride !== undefined,
    host: () => host,
    codeMode: () => codeMode,
    currentModel: () => client.model,
    fetchModelList,
    themeName: () => themeName,
    applyTheme: (name) => {
      themeName = name;
      paint = resolvePalette(name, caps);
      screen.invalidate();
    },
    session: () => session,
    messages: () => messages,
    stats,
    anchors,
    config,
    modelMeta: () => currentModelMeta,
    contextLegendRow: () =>
      paint.dim(`  ${contextLegend(paint, contextBreakdown(contextView()).segments.filter((s) => s.tokens > 0))}`),
    listSessions: () => listRecentSessions(sessionsRoot(), SESSION_LIST_LIMIT),
    newSession: async () => {
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
      return session.file;
    },
    startCompactWait: () => compactWait.start('正在压缩会话'),
    endCompactWait: () => compactWait.end(),
    compactCancelled: () => compactWait.wasCancelled(),
    compactDoneLine: (outcome) => compactWait.doneLine(outcome),
    runManualCompact: () => runCompact('manual'),
    abortAllTurns: () => {
      for (const aborter of aborters) aborter.abort();
    },
    exit: exitApp,
    clearView: () => {
      bgSubagentRows.clear();
      modeSelector.reset();
      store.clearView();
    },
    writeAgents: () => writeAgentsMd(rootDir),
  });
  const runCommand = (raw: string): Promise<void> => commands.run(raw);

  /**
   * /session 切换（状态机出壳 ./tui/session-switch.ts，阶段 E）：这里只剩
   * 壳层回调接线。rebind 改变 session/messages 绑定；afterRebind 做缓存亲和
   * 重绑与清场簿记（与 /new 同理：恢复的历史改变 prompt 前缀，锚点必须归零，
   * 下一轮重建缓存而非触发伪压缩）。
   */
  const switchToSession = (entry: { file: string }): Promise<void> =>
    switchSessionTo(
      {
        store,
        paint: () => paint,
        loadSession: (file) => Session.open(file),
        workspaceOf: sessionWorkspace,
        currentRoot: () => rootDir,
        isInDataDir: (dir) => {
          const rel = path.relative(novaHome(), dir);
          return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        },
        dirExists: (dir) => existsSync(dir),
        applyWorkspace,
        rebind: (loaded, restored) => {
          session = loaded;
          messages = restored;
        },
        afterRebind: (loaded) => {
          client.setSessionId(loaded.id);
          Object.assign(stats, emptyStats());
          resetUsageAnchors(anchors);
          resetSessionCache();
          bgSubagentRows.clear();
          modeSelector.reset();
          store.clearView();
          store.activeToolId = undefined;
        },
        render: scheduleRender,
      },
      entry,
    );

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
    modeSelector.collapse();
    if (store.streaming || store.compactRunning) {
      const cmd = text.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (STREAM_SAFE_COMMANDS.has(cmd)) {
        store.setInputAll('');
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
        store.setInputAll('');
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
    store.setInputAll('');
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
    abortCompact: () => compactWait.cancel(),
    modeSelectMove: (delta) => modeSelector.move(delta),
    modeSelectConfirm: (index) => void modeSelector.confirm(index),
    modeSelectDismiss: () => modeSelector.dismiss(),
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
    // 焦点回归重断言 DEC 模式（M10 R6）：ConPTY 中继可能中途剥掉私有模式，
    // SGR 鼠标静默降级成 X10，上报会以转义乱码画进帧里；focusin 是这种重置
    // 后必到的事件。focusout 消费掉不进责任链。
    if (k.type === 'focusin') screen.reassertModes();
    else if (k.type === 'focusout') return;
    else tuiHandleKey(keyEnv, k);
  }


// ---- rendering --------------------------------------------------------
  /**
   * 整帧装配出壳 ./tui/frame-assembler.ts（阶段 E）：展平缓存、上帧行数基准
   * 与仪表三档缓存都收敛在类里；壳层只提供当前快照与写入通道。
   */
  const assembler = new FrameAssembler({
    store,
    paint: () => paint,
    cols: () => screen.cols,
    rows: () => screen.rows,
    activeView: (viewDeps, cols) => resolveActiveView(store, paint, cols, viewDeps),
    // 访问器（非值）：statusView/contextView 在壳层更下方声明，且读活状态。
    statusView: () => statusView(),
    contextView: () => contextView(),
    gaugeKeyParts: () => ({
      messagesLen: messages.length,
      usageAnchor: anchors.usageAnchor,
      model: client.model,
      codeMode,
      modelMetaVersion,
      capacity: config.provider.contextWindow ?? currentModelMeta?.contextWindow,
      toolCount: host.tools.length,
      compactLimit: config.autoCompactTokenLimit,
    }),
    write: (lines, cursor) => screen.render(lines, cursor),
  });

  function renderFrame(): void {
    if (exiting) return;
    // 活动弹窗纯选择（./frame.ts resolveActiveView）：审批 > 模型 > 会话 >
    // 命令面板。弹窗行折行会把整体顶出视口，构建器按剩余列数裁剪；键交互
    // 留在 handleKey 的责任链层。
    assembler.render({
      commandMatches: filterCommands(store.input),
      modelContextTokens: (name) => modelMetaStore.peek(name, config.provider.baseURL)?.contextWindow,
      currentModel: client.model,
      currentSessionFile: session.file,
    });
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

  /** 状态栏的帧快照：闭包可变状态 → 纯函数入参（见 ./statusbar.ts）。
   *  上下文仪表三档形态经 assembler.gaugeForms()（缓存随帧装配器走）。 */
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
    gaugeForms: assembler.gaugeForms(),
  });

  // ---- lifecycle --------------------------------------------------------
  function exitApp(): void {
    if (exiting) return;
    exiting = true;
    spinner.stop();
    bgSubagentRows.stop();
    compactWait.end();
    compactWait.abortActive();
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
    assembler.invalidate();
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
  modeSelector.show();

  await new Promise<void>((resolve) => {
    exitNow = resolve;
  });
  console.log(`会话已保存：${session.file}`);
}
