import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KeyDecoder, LineScreen, styledWidth, wrapLine, type Key } from '@nova-agent/tui';
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  DEFAULT_MAX_TURNS,
  emptyStats,
  estimateNextPromptTokens,
  estimateTextTokens,
  JobRegistry,
  newId,
  runAgent,
  Session,
  type AgentEvent,
  type AgentMessage,
  type ToolCall,
  type Usage,
  type UsageStats,
  type UserMessage,
} from '@nova-agent/core';
import {
  builtinPlugins,
  codeRuntimeAvailable,
  loadSkills,
  PermissionService,
  PluginHost,
  skillsPlugin,
  type ApprovalMode,
  type AskFn,
  type PermissionKind,
  type PtcMode,
} from '@nova-agent/plugins';
import { collectProjectDocs, writeAgentsMd } from './agents-md.js';
import { compactSession, surfaceDivergence, type CompactedSession } from './compact.js';
import { composerWrapBudget, cursorPosition, composerZone } from './composer.js';
import {
  COMMAND_SPECS,
  createModelListCache,
  filterCommands,
  type CommandSpec,
} from './commands.js';
import { NOVA_DIR, novaHome, sessionDateBucket, sessionsRoot, type Config } from './config.js';
import { buildContextFragment, declaredShell, expandSkillInvocation, type SessionEnvInfo } from './context.js';
import { createMarkdownRenderer, type MarkdownRenderer } from './markdown.js';
import { createNotifier } from './notify.js';
import { createModelMetaStore, formatModelMeta, type ModelMeta } from './model-meta.js';
import { listRecentSessions, recordSessionWorkspace, sessionWorkspace, type SessionEntry } from './sessions.js';
import { buildSystemPrompt } from './system-prompt.js';
import {
  approvalLabel,
  APPROVAL_ORDER,
  clipToWidth,
  contextGaugeForms,
  contextLegend,
  cursorAfterVerticalMove,
  fitTail,
  humanTokens,
  isFailureContent,
  isReadOnlyTool,
  layoutComposer,
  padDisplay,
  palette,
  permissionLabel,
  plainPalette,
  SPINNER_FRAMES,
  statusLine,
  toolArgSummary,
  toolDoneLine,
  toolGroupLine,
  toolLabel,
  toolStartLine,
  type StopKind,
} from './ui.js';
import { buildApprovalPopup, buildCommandPopup, buildModelPopup, buildSessionPopup } from './popup.js';
import {
  codeModeLabel,
  contextBreakdown,
  gaugeCacheKey,
  statusBar,
  type ContextBreakdownView,
  type StatusView,
} from './statusbar.js';

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

/** Composer 最多占用的屏幕行数；超出后窗口随光标滑动并显示上下提示。 */
const COMPOSER_MAX_ROWS = 8;
/** 单次粘贴的字符上限：超过即截断（防止一次超巨粘贴把输入区撑爆）。 */
const PASTE_MAX_CHARS = 200_000;

/** Reasoning display caps: committed lines kept, and the live line's tail.
 * 思考是过程性内容：只保留最后 2 行活尾，结束后整段折成一行耗时摘要。 */
const REASONING_MAX_LINES = 2;
const REASONING_MAX_PARTIAL_CHARS = 240;
/** Approval popup preview cap: diff rows are precious screen real estate. */
const APPROVAL_PREVIEW_MAX_ROWS = 20;

interface Block {
  lines: string[];
  wrapped: string[] | undefined;
  /**
   * Hanging-indent gutter applied at wrap time: the block's first non-empty
   * row gets `first` (marker + lane), every other row — including rows
   * produced by soft wrapping — aligns under it with `rest`.
   */
  gutter?: { first: string; rest: string };
}

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
  let messages: AgentMessage[] = [];
  let session: Session;
  if (opts.resumeFile) {
    session = await Session.open(opts.resumeFile);
    messages = session.deriveMessages();
  } else {
    session = await Session.create(sessionsDir);
    await recordSessionWorkspace(session, rootDir);
  }

  const client = new OpenAICompatClient({
    baseURL: config.provider.baseURL,
    apiKey: config.provider.apiKey,
    model: config.provider.model,
    sessionId: session.id,
    ...(config.provider.temperature !== undefined ? { temperature: config.provider.temperature } : {}),
    ...(config.provider.maxTokens !== undefined ? { maxTokens: config.provider.maxTokens } : {}),
  });
  /** 站点模型目录（GET /models），/model 用；60s 缓存避免连续操作反复请求。 */
  const fetchModelList = createModelListCache(() => client.listModels());
  const jobs = new JobRegistry();
  const stats: UsageStats = emptyStats();
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
  const approvalMode = opts.approvalOverride ?? config.approval ?? 'read-only';

  const bashConfig = config.tools?.bash;
  const codeConfig = config.tools?.code;
  // 执行模式：TUI 里 Tab 在新会话开始时循环 普通 → PTC → 混合。config 的
  // tools.code.mode 只是初始值；其余 tools.code 调参（超时/预算）在每次
  // 重建 host 时原样带上。
  let codeMode: PtcMode = codeConfig?.mode ?? 'native';
  let modeSwitching = false;
  const bashPluginArgs = (): Parameters<typeof builtinPlugins>[0] => ({
    bash:
      bashConfig?.enabled === false
        ? false
        : {
            ...(bashConfig?.timeoutMs !== undefined ? { timeoutMs: bashConfig.timeoutMs } : {}),
            ...(bashConfig?.shellPath !== undefined ? { shellPath: bashConfig.shellPath } : {}),
          },
    code: { ...codeConfig, mode: codeMode },
  });
  const loadWorkspaceSkills = (dir: string): ReturnType<typeof loadSkills> =>
    loadSkills([
      { dir: path.join(dir, NOVA_DIR, 'skills'), level: 'project' },
      { dir: path.join(os.homedir(), '.nova', 'skills'), level: 'user' },
    ]);
  let skills = await loadWorkspaceSkills(rootDir);
  // 占位：真正的带插件激活在 permission/hooks 就绪后由 rebuildHost() 完成。
  let host = new PluginHost(rootDir);

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

  const sessionEnv: SessionEnvInfo = {
    platform: process.platform,
    cwd: rootDir,
    // Must match the shell the bash tool really runs (invocation() resolution),
    // or the model writes commands for the wrong interpreter.
    shell: declaredShell(bashConfig?.shellPath),
    today: new Date().toISOString().slice(0, 10),
  };
  // AGENTS.md chain is session-stable by design; /init results land in the next session.
  let projectDocs = await collectProjectDocs(rootDir, process.cwd());
  const buildFragment = (): string => buildContextFragment(sessionEnv, config.systemPrompt, skills, projectDocs);
  /** Re-seed the context fragment when a fresh session starts (/new). */
  const seedContextFragment = async (): Promise<void> => {
    const seed: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: buildFragment() };
    messages.push(seed);
    await session.append(seed);
  };
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
    projectDocs = await collectProjectDocs(dir, process.cwd());
    skills = await loadWorkspaceSkills(dir);
    await rebuildHost();
  };
  if (!opts.resumeFile) await seedContextFragment();

  /**
   * Approval popup + long-turn completion/error surface as OS notifications
   * too: the user regularly switches away while the agent works, and a
   * pending approval without a toast just looks like a frozen session.
   */
  const notify = createNotifier({ enabled: config.notify !== false });
  const askApproval: AskFn = (call, kind) =>
    new Promise((resolve) => {
      approvalRequest = { call, kind, resolve };
      approvalIndex = 0;
      approvalPreview = undefined;
      // Best-effort effect preview (edit_file's diff etc.) inside the popup —
      // the user approves what the call WILL do, not just the arg JSON.
      // Rendered when it lands; dropped when the popup already closed.
      const entry = host.toolEntries.find((e) => e.tool.name === call.name);
      if (entry !== undefined && entry.tool.preview !== undefined) {
        void Promise.resolve(entry.tool.preview(call.args, { rootDir }))
          .then((text) => {
            if (approvalRequest !== undefined && approvalRequest.call.id === call.id) {
              approvalPreview = text.trim().split('\n').slice(0, APPROVAL_PREVIEW_MAX_ROWS);
              scheduleRender();
            }
          })
          .catch(() => {});
      }
      scrollFromEnd = 0;
      notify('需要审批', `${toolLabel(call.name)} · ${toolArgSummary(call.name, call.rawArgs, 80)}`);
      scheduleRender();
    });
  const permission = new PermissionService(approvalMode, askApproval, (entry) => {
    // Log-only approval audit trail; survives resume via the session log.
    void session
      .appendEvent({ type: 'approval', toolName: entry.toolName, kind: entry.kind, outcome: entry.outcome, at: Date.now() })
      .catch(() => {});
  });
  // Reassigned by rebuildHost(): the agent loop must read hooks from the
  // SAME host instance it reads tools from (one rebuild = tools + projection).
  let hooks = host.agentHooks(permission);
  const systemPrompt = buildSystemPrompt();
  await rebuildHost();

  // ---- ui state ---------------------------------------------------------
  const blocks: Block[] = [];
  const historyStack: string[] = [];
  let scrollFromEnd = 0;
  let input = '';
  let cursorPos = 0; // char index into input
  let popupIndex = 0;
  /**
   * Esc closes the command palette until the input changes again — otherwise
   * the popup would instantly re-open on the next keystroke while typing a
   * non-command message that happens to start with "/".
   */
  let popupDismissed = false;
  const commandPopupMatches = (): CommandSpec[] => (popupDismissed ? [] : filterCommands(input));
  /**
   * Interactive model picker (opened by bare /model): a floating overlay like
   * the approval dialog, NOT a history dump — long catalogs scroll inside the
   * panel with a sliding window instead of flooding the transcript.
   */
  const MODEL_PICKER_WINDOW = 10;
  /** 会话切换器：弹窗可视行数与列举条数上限。 */
  const SESSION_PICKER_WINDOW = 8;
  const SESSION_LIST_LIMIT = 30;
  let modelPicker: { models: string[]; index: number } | undefined;
  let sessionPicker: { entries: SessionEntry[]; index: number } | undefined;
  let historyIdx = -1;
  let historyDraft = '';
  let lastUsage: Usage | undefined;
  let lastPromptTokens = 0;
  // Last successful usage acts as the anchor for pre-flight token estimates
  // (dsh token-meter anchor + delta repricing, whole-message granularity).
  let usageAnchor: Usage | undefined;
  let anchorMsgCount = 0;
  let compactRunning = false;
  let approvalRequest: { call: ToolCall; kind: PermissionKind; resolve: (a: 'allow' | 'deny' | 'always') => void } | undefined;
  /** Selected option in the approval popup (codex-style: arrows + Enter). */
  let approvalIndex = 0;
  /** Best-effort effect preview lines for the pending approval (async-filled). */
  let approvalPreview: string[] | undefined;
  const APPROVAL_CHOICES = ['allow', 'always', 'deny'] as const;
  let spinnerFrame = 0;
  let exitNow: (() => void) | undefined;
  let lastCtrlC = 0;
  /** Timestamp of the last Esc/Ctrl+C interrupt request; 0 when idle. Drives the "正在中断…" feedback. */
  let interruptAt = 0;

  // Blocks never touch scrollFromEnd: when the user has scrolled up, the
  // viewport stays anchored to their position instead of snapping to bottom
  // on every streamed token.
  const pushBlock = (lines: string[], gutter?: Block['gutter']): void => {
    blocks.push({ lines, wrapped: undefined, ...(gutter !== undefined ? { gutter } : {}) });
    scheduleRender();
  };
  const updateLastBlock = (lines: string[]): void => {
    if (blocks.length === 0) {
      pushBlock(lines);
      return;
    }
    const last = blocks[blocks.length - 1];
    if (last === undefined) return;
    last.lines = lines;
    last.wrapped = undefined;
    scheduleRender();
  };
  const replaceBlock = (block: Block, lines: string[]): void => {
    if (!blocks.includes(block)) {
      // Stale ref: /clear (or another wipe) removed the block while a stream
      // still held it. Re-materialize instead of writing into an orphan.
      blocks.push({ lines, wrapped: undefined, ...(block.gutter !== undefined ? { gutter: block.gutter } : {}) });
    } else {
      block.lines = lines;
      block.wrapped = undefined;
    }
    scheduleRender();
  };
  /**
   * Live tool blocks keyed by call id. Parallel tool segments produce
   * consecutive starts before any result, so results must update the block
   * that belongs to THEIR call — updating the last block would clobber a
   * sibling call's entry. `tailBuf` accumulates the tool's streamed output
   * (bash) so the spinner tick can show a live "└ tail" progress line.
   */
  const toolBlocks = new Map<
    string,
    { block: Block; startAt: number; name: string; rawArgs: string; tailBuf?: string }
  >();
  /** The tool call currently executing; progress text routes to its block. */
  let activeToolId: string | undefined;
  /**
   * Consecutive completed read-only calls collapse into one "查看" line
   * (codex "Explored" cell): each result's live block is removed and its
   * summary joins the group instead of leaving a line of its own.
   */
  let readGroup: { entries: string[]; startAt: number; block: Block } | undefined;
  /** The streaming reasoning block, folded to a one-line summary once done. */
  let reasoningBlock: Block | undefined;

  const closeReadGroup = (): void => {
    readGroup = undefined;
  };

  const removeBlock = (block: Block): void => {
    const idx = blocks.indexOf(block);
    if (idx >= 0) blocks.splice(idx, 1);
  };

  // TPS 采样（借鉴"可观察的 Agent 状态"）：delta 里累计估算 token，spinner
  // tick 每 500ms 折算一次速率进 10 格环形窗口（≈5 秒趋势）。sparkline 长度
  // 恒定，数字右对齐到 3 位宽——速度表自身不引发横移。
  const TPS_SAMPLES = 10;
  const TPS_INTERVAL_MS = 500;
  const tpsRing: number[] = Array<number>(TPS_SAMPLES).fill(0);
  let tpsTokens = 0;
  let tpsLastTokens = 0;
  let tpsLastAt = 0;

  /**
   * 生成阶段（驱动 tps 仪表与输入行 spinner 的颜色）。thinking/writing =
   * 模型正在产出 token（绿，速度表"活"）；tool = 停在工具等待（无 token
   * 流动，仪表冻结转暗）；idle = 空闲。旧版只有一个 streaming 布尔，思考/
   * 工具/输出全算"流式"，用户在长思考段里看到的速度表却几乎不动——阶段
   * 显式化后"绿色 = 正在生成"的含义才立得住。
   */
  let genPhase: 'idle' | 'thinking' | 'writing' | 'tool' = 'idle';

  const spinner = {
    start() {
      spinnerTimer ??= setInterval(() => {
        spinnerFrame += 1;
        // Animate the bullet of every running tool block (codex-style
        // activity marker) and the composer-prefix spinner. After two
        // seconds a live elapsed suffix appears so a slow command never
        // looks frozen (Claude Code's bash progress counter).
        const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? '•';
        const now = Date.now();
        if (now - tpsLastAt >= TPS_INTERVAL_MS) {
          const secs = (now - tpsLastAt) / 1000;
          // 只在确有新增输出时推一个采样——轮内的思考停顿 / 工具等待不推 0，
          // 否则连续几个 500ms 空窗会把 10 格窗口排空成"▁▁… 0"（用户看到的
          // "偶尔清零"）。无新数据就只推进时钟、冻结窗口，速度表随真实产出左滚。
          if (tpsTokens > tpsLastTokens) {
            tpsRing.push(Math.round((tpsTokens - tpsLastTokens) / secs));
            if (tpsRing.length > TPS_SAMPLES) tpsRing.shift();
          }
          tpsLastTokens = tpsTokens;
          tpsLastAt = now;
        }
        for (const entry of toolBlocks.values()) {
          const elapsed = now - entry.startAt;
          const suffix = interruptAt > 0
            ? `${YELLOW} · 正在中断…${RESET}`
            : elapsed >= 2000
              ? `${DIM} · ${Math.floor(elapsed / 1000)}s${RESET}`
              : '';
          // 预算扣掉 suffix 的位（` · Ns` / ` · 正在中断…`），整行含后缀恒单行。
          const lines = [toolStartLine(paint, entry.name, entry.rawArgs, frame, screen.cols - 15) + suffix];
          // Live output tail for streaming tools (bash): the last line of
          // whatever the process has printed so far. This is what keeps a
          // 2-minute pnpm install from looking like a hang.
          const tailBuf = entry.tailBuf;
          if (tailBuf !== undefined) {
            const last = tailBuf.slice(tailBuf.lastIndexOf('\n') + 1).trimEnd();
            if (last.length > 0) {
              lines.push(`      ${DIM}└ ${fitTail(last, Math.max(10, screen.cols - 9))}${RESET}`);
            }
          }
          replaceBlock(entry.block, lines);
        }
        scheduleRender();
      }, 90);
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
    }, 16);
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
  let streaming = false;

  /** Shared in-place compaction used by /compact, the auto threshold and the pre-flight check. */
  const runCompact = async (trigger: 'auto' | 'manual'): Promise<CompactedSession> => {
    compactRunning = true;
    try {
      const outcome = await compactSession({
        client,
        session,
        messages,
        trigger,
      });
      messages = outcome.surface;
      Object.assign(stats, emptyStats());
      lastUsage = undefined;
      lastPromptTokens = 0;
      usageAnchor = undefined;
      anchorMsgCount = 0;
      return outcome;
    } finally {
      compactRunning = false;
    }
  };

  /**
   * Pre-flight compaction check (dsh token-meter anchor semantics): project
   * the NEXT prompt tokens from the last successful usage anchor plus the
   * messages appended since, so compaction can fire BEFORE a request that
   * would overflow instead of after it.
   */
  const maybePreCompact = async (): Promise<void> => {
    const limit = config.autoCompactTokenLimit;
    if (limit === undefined || compactRunning || usageAnchor === undefined) return;
    const estimate = estimateNextPromptTokens(usageAnchor, messages.slice(anchorMsgCount));
    if (estimate <= limit) return;
    pushBlock([`${YELLOW}  ⋯ 预估下轮 ${humanTokens(estimate)} tok 超阈值 ${humanTokens(limit)}，提前压缩…${RESET}`]);
    try {
      const outcome = await runCompact('auto');
      pushBlock([`${GREEN}  ✓ 已压缩${RESET} ${DIM}· 摘要 ${outcome.summary.length} 字 · 保留 ${outcome.retained} 条最近消息${RESET}`]);
    } catch (err) {
      // A failed compaction must not kill the turn (agentTurn is invoked
      // fire-and-forget); the conversation continues uncompressed.
      pushBlock([`${RED}  ✗ 预压缩失败：${err instanceof Error ? err.message : String(err)}${RESET}`], {
        first: '',
        rest: '      ',
      });
    }
  };

  /** Fallback: auto-compact AFTER a turn when its prompt tokens exceeded the threshold. */
  const maybeAutoCompact = async (): Promise<void> => {
    const limit = config.autoCompactTokenLimit;
    if (limit === undefined || compactRunning || lastPromptTokens <= limit) return;
    pushBlock([`${YELLOW}  ⋯ 上下文 ${humanTokens(lastPromptTokens)} tok 超阈值，正在压缩…${RESET}`]);
    try {
      const outcome = await runCompact('auto');
      pushBlock([`${GREEN}  ✓ 已压缩${RESET} ${DIM}· 摘要 ${outcome.summary.length} 字 · 保留 ${outcome.retained} 条最近消息${RESET}`]);
    } catch (err) {
      pushBlock([`${RED}  ✗ 自动压缩失败：${err instanceof Error ? err.message : String(err)}${RESET}`], {
        first: '',
        rest: '      ',
      });
    }
  };

  /** Remove the live reasoning block once it ends: the answer, not the
   * thinking, is what the user came for — only the streaming tail is shown. */
  const discardReasoning = (): void => {
    if (reasoningBlock === undefined) return;
    const idx = blocks.indexOf(reasoningBlock);
    if (idx >= 0) blocks.splice(idx, 1);
    reasoningBlock = undefined;
    scheduleRender();
  };

  async function agentTurn(userInput: string): Promise<void> {
    const userMsg: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: userInput };
    messages.push(userMsg);
    await session.append(userMsg);
    pushBlock(['', userInput], {
      first: `  ${CYAN}${BOLD}❯${RESET} ${BOLD}`,
      rest: `    ${BOLD}`,
    });

    await maybePreCompact();

    const aborter = new AbortController();
    aborters.push(aborter);
    streaming = true;
    spinner.start();
    genPhase = 'thinking';
    // tps 是会话级连续滚动速度表：新一轮不清空 ring、不把 tpsTokens 归零，
    // 新采样直接接在旧窗口左移，避免发送时"闪回 0"的跳变。只把基线锚到本轮
    // 起点——tpsLastTokens 取当前累计值，令本轮首个采样只计新输出的 token；
    // tpsLastAt 重置，把空闲间隔排除在首样分母外（否则跨分钟的 secs 会压出
    // 一个假 0）。tpsTokens 全程单调累加。
    tpsLastTokens = tpsTokens;
    tpsLastAt = Date.now();
    const startedAt = Date.now();
    let assistantText = '';
    let assistantOpen = false;
    let assistantBlock: Block | undefined;
    /** The blank separator block openAssistant pushes before each answer. */
    let assistantSeparator: Block | undefined;
    /** Incremental markdown renderer; re-created when a new answer opens. */
    let md: MarkdownRenderer | undefined;
    /**
     * Reasoning renders line-based: committed lines are wrapped ONCE and then
     * never move (only the front falls off past the cap); the live tail row
     * is the only thing that repaints per delta. The old sliding-500-char
     * single-line window shifted every row on every delta, which repainted
     * the whole block at stream speed and scrolled the screen.
     */
    const reasoningDone: string[] = [];
    let reasoningPartial = '';
    let reasoningOpen = false;
    let reasoningStartedAt = 0;
    /**
     * 思考段收尾：正文不留档，整块折成一行耗时摘要（codex "Thought for Ns"
     * 式）。答案开始时同样走这里——摘要留在记录里，用户知道模型想过多久，
     * 但满屏的自言自语不再占据对话区。
     */
    const foldToSummary = (): void => {
      const block = reasoningBlock;
      const had = block !== undefined && (reasoningDone.length > 0 || reasoningPartial.length > 0);
      const secs = reasoningStartedAt > 0
        ? Math.max(1, Math.round((Date.now() - reasoningStartedAt) / 1000))
        : 0;
      reasoningBlock = undefined;
      reasoningStartedAt = 0;
      if (had && block !== undefined) {
        replaceBlock(block, [`${DIM}已思考 ${secs}s${RESET}`]);
        scheduleRender();
      } else {
        discardReasoning();
      }
    };
    try {
      for await (const event of runAgent({
        provider: client,
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
        // Live bash output lands in the running tool block's tail buffer; the
        // spinner tick renders it (never a render per chunk).
        onToolProgress: (text) => {
          const entry = activeToolId !== undefined ? toolBlocks.get(activeToolId) : undefined;
          if (entry === undefined) return;
          const merged = (entry.tailBuf ?? '') + text;
          entry.tailBuf = merged.length > 8000 ? merged.slice(-4000) : merged;
        },
        signal: aborter.signal,
      })) {
        await onAgentEvent(event, startedAt, {
          appendAssistant(text: string) {
            tpsTokens += estimateTextTokens(text);
            if (!assistantOpen) {
              // Whitespace-only leading deltas (models often emit blank lines
              // before tool calls) must not anchor a blank answer block above
              // the tool lines — skip them until real content arrives.
              if (text.trim().length === 0) return;
              assistantOpen = true;
              assistantText = '';
              assistantBlock = undefined;
              genPhase = 'writing';
              reasoningOpen = false;
              closeReadGroup();
              foldToSummary();
              reasoningDone.length = 0;
              reasoningPartial = '';
              md = createMarkdownRenderer(paint);
              // A dedicated separator block between the question and the
              // answer — the answer gets its OWN block so the separator
              // survives every delta update.
              pushBlock(['']);
              assistantSeparator = blocks[blocks.length - 1];
            }
            assistantText += text;
            // Claude Code / codex both anchor each reply with a dot marker.
            // The marker lives in the block gutter (applied at wrap time), so
            // soft-wrapped continuation lines align under the text column.
            // Complete markdown lines render once and are cached — only the
            // trailing unfinished line re-renders per delta.
            const lines = md !== undefined ? md.push(text) : [];
            if (assistantBlock === undefined) {
              pushBlock(lines, { first: `  ${DIM}•${RESET} `, rest: '    ' });
              assistantBlock = blocks[blocks.length - 1];
            } else {
              replaceBlock(assistantBlock, lines);
            }
          },
          appendReasoning(text: string) {
            tpsTokens += estimateTextTokens(text);
            if (assistantOpen) return;
            genPhase = 'thinking';
            if (!reasoningOpen) {
              reasoningOpen = true;
              reasoningStartedAt = Date.now();
              reasoningDone.length = 0;
              reasoningPartial = '';
              // Reasoning is secondary content: every row sits at the text
              // column (no marker on the first row — an unmarked first row at
              // the marker column just reads as a stray outdented line).
              pushBlock([], { first: '    ', rest: '    ' });
              reasoningBlock = blocks[blocks.length - 1];
            }
            // Split complete lines off the live buffer; only the partial row
            // churns, committed rows above it are stable across deltas.
            const parts = `${reasoningPartial}${text}`.split('\n');
            reasoningPartial = parts.pop() ?? '';
            for (const line of parts) {
              reasoningDone.push(line);
              if (reasoningDone.length > REASONING_MAX_LINES) reasoningDone.shift();
            }
            // A paragraph without newlines must not wrap forever: keep only
            // the tail of the live line (one reflow when the cap trips).
            if (reasoningPartial.length > REASONING_MAX_PARTIAL_CHARS) {
              reasoningPartial = `…${reasoningPartial.slice(-REASONING_MAX_PARTIAL_CHARS)}`;
            }
            // The whole block reads as "thinking": every row dim, the live
            // tail carries the ⋯ marker. Committed rows stay dim — dimming
            // only the tail made settled lines jump to full brightness the
            // moment the stream moved past them.
            const lines = [
              ...reasoningDone.map((line) => (line.length === 0 ? '' : `${DIM}${line}${RESET}`)),
              `${DIM}⋯ ${reasoningPartial}${RESET}`,
            ];
            // The update goes to the block's stable ref — the last block may
            // be a tool line, and clobbering it must not erase history.
            if (reasoningBlock !== undefined) replaceBlock(reasoningBlock, lines);
            else updateLastBlock(lines);
          },
          closeAssistant() {
            if (assistantOpen && assistantText.trim().length === 0) {
              // A whitespace-only answer (blank lines before tool calls)
              // leaves no trace: drop the blank block and its separator by
              // identity — tool blocks may sit after them by now.
              if (assistantBlock !== undefined) removeBlock(assistantBlock);
              if (assistantSeparator !== undefined) removeBlock(assistantSeparator);
            }
            assistantOpen = false;
          },
          foldReasoning() {
            foldToSummary();
            reasoningDone.length = 0;
            reasoningPartial = '';
            reasoningOpen = false;
          },
          resetAssistant() {
            // A provider retry replays the answer from scratch: the partial
            // text and its separator belong to the failed attempt — drop both.
            if (assistantBlock !== undefined) removeBlock(assistantBlock);
            if (assistantSeparator !== undefined) removeBlock(assistantSeparator);
            assistantBlock = undefined;
            assistantSeparator = undefined;
            assistantOpen = false;
            assistantText = '';
            // 重试的失败尝试不留任何痕迹（包括思考摘要行）。
            discardReasoning();
            reasoningStartedAt = 0;
            reasoningOpen = false;
            reasoningDone.length = 0;
            reasoningPartial = '';
          },
        });
      }
    } catch (err) {
      spinner.stop();
      closeReadGroup();
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(message))) {
        pushBlock([`${YELLOW}  ■ 已中断${RESET}`]);
      } else {
        // API errors can be long: hang wrapped rows under the notice column.
        pushBlock([`${RED}  ✗ 出错：${message}${RESET}`], { first: '', rest: '      ' });
        // A turn that died mid-work (not a user abort) deserves a ping too —
        // but only when it ran long enough that the user may have walked away.
        if (!exiting && Date.now() - startedAt >= 5000) {
          notify('任务出错', message.slice(0, 120));
        }
      }
    } finally {
      const idx = aborters.indexOf(aborter);
      if (idx >= 0) aborters.splice(idx, 1);
      streaming = false;
      interruptAt = 0;
      genPhase = 'idle';
      spinner.stop();
      // An abort/error never reaches the 'done' event: recycle the reasoning
      // tail here so no transient line survives into history.
      discardReasoning();
      reasoningOpen = false;
      reasoningDone.length = 0;
      reasoningPartial = '';
      closeReadGroup();
      // Runtime invariant (NOVA_DEBUG): the live surface must stay equal to
      // the session log projection — "model-visible means logged".
      if (process.env['NOVA_DEBUG'] !== undefined) {
        const divergence = surfaceDivergence(session, messages);
        if (divergence !== undefined) pushBlock([`${RED}  [invariant] ${divergence}${RESET}`]);
      }
      // Long turns end while the user is elsewhere: the toast is the "come
      // back, it's done" cue (short turns stay silent — that's just spam).
      const elapsed = Date.now() - startedAt;
      if (!exiting && elapsed >= 15_000) {
        notify('任务已完成', `本轮耗时约 ${Math.max(1, Math.round(elapsed / 1000 / 60))} 分钟，回到终端查看结果`);
      }
      scheduleRender();
    }
    await maybeAutoCompact();
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
        genPhase = 'thinking'; // 重新请求在途，属于"生成中"
        pushBlock([`${DIM}  ⟳ 上游流中断（${event.error}），自动重试 ${event.attempt}/${event.maxRetries}…${RESET}`], {
          first: '',
          rest: '      ',
        });
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
        genPhase = 'tool';
        // A new non-read call ends the current read-only group.
        if (!isReadOnlyTool(event.call.name)) closeReadGroup();
        const block: Block = {
          lines: [toolStartLine(paint, event.call.name, event.call.rawArgs, '•', screen.cols - 1)],
          wrapped: undefined,
          // Soft-wrapped continuation rows hang under the summary column.
          gutter: { first: '', rest: '      ' },
        };
        blocks.push(block);
        toolBlocks.set(event.call.id, { block, startAt: Date.now(), name: event.call.name, rawArgs: event.call.rawArgs });
        activeToolId = event.call.id;
        scheduleRender();
        break;
      }
      case 'tool_call_result': {
        await session.append(event.result);
        const entry = toolBlocks.get(event.call.id);
        toolBlocks.delete(event.call.id);
        if (activeToolId === event.call.id) activeToolId = undefined;
        const duration = entry === undefined ? 0 : Math.max(0, Date.now() - entry.startAt);
        const failed = isFailureContent(event.result.content);
        if (isReadOnlyTool(event.call.name) && !failed) {
          // codex "Explored": the read's own line disappears and its summary
          // folds into the running group line.
          if (entry !== undefined) removeBlock(entry.block);
          // 宽预算存原文：公共目录折叠与最终排布都发生在 toolGroupLine 渲染时。
          const raw = toolArgSummary(event.call.name, event.call.rawArgs, 400);
          const summary = raw.length === 0 || raw === '{}' ? toolLabel(event.call.name) : raw;
          if (readGroup === undefined) {
            const block: Block = { lines: [], wrapped: undefined, gutter: { first: '', rest: '      ' } };
            blocks.push(block);
            readGroup = {
              entries: [summary],
              startAt: entry === undefined ? Date.now() - duration : entry.startAt,
              block,
            };
          } else {
            readGroup.entries.push(summary);
          }
          replaceBlock(readGroup.block, [
            toolGroupLine(paint, readGroup.entries, Date.now() - readGroup.startAt, screen.cols - 1),
          ]);
        } else {
          closeReadGroup();
          const lines = toolDoneLine(
            paint,
            event.call.name,
            event.call.rawArgs,
            event.result.content,
            duration,
            screen.cols - 1,
          );
          if (entry !== undefined) replaceBlock(entry.block, lines);
          else pushBlock(lines);
        }
        break;
      }
      case 'usage':
        Object.assign(stats, event.stats);
        lastUsage = event.usage;
        lastPromptTokens = event.usage.promptTokens;
        usageAnchor = event.usage;
        anchorMsgCount = messages.length;
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
        closeReadGroup();
        io.foldReasoning();
        // A normal completion ends at the reply — no per-turn stats line (the
        // status bar carries tokens; /session carries details). Only abnormal
        // stops get a visible marker.
        if (event.stopReason !== 'complete') {
          const kind: StopKind = event.stopReason;
          pushBlock([statusLine(paint, kind, stats, Date.now() - startedAt)]);
          if (kind === 'max_turns') {
            pushBlock([
              `${DIM}  已达 maxTurns 上限（当前 ${config.maxTurns ?? DEFAULT_MAX_TURNS}，可在 .nova/config.json 调大后 /resume 继续）${RESET}`,
            ]);
          }
        }
        break;
      }
    }
  }

  // ---- execution mode (Tab) ---------------------------------------------
  /**
   * 新会话的"未开始"判据：只有种子片段（或干脆为空），且没有进行中的轮。
   * Tab 只在这一刻可用——模式决定 run_code 是否注册进 host，会话一旦
   * 跑起来再换 host 会造成已见工具与后续请求不一致。
   */
  const sessionPristine = (): boolean =>
    !streaming && !compactRunning && !modeSwitching && messages.length <= 1 && input.length === 0;

  /**
   * 芯片呈现的"未开始"判据：与 sessionPristine 的区别是不看 modeSwitching。
   * 切换模式时 modeSwitching 会置 true 一整段 rebuild 窗口——若芯片按它
   * 渲染，三枚会先塌成当前一枚再弹回，整行状态栏随之闪一下（Tab 每次按下
   * 都同步重绘，这正是用户看到的闪烁）。
   */
  const displayPristine = (): boolean =>
    !streaming && !compactRunning && messages.length <= 1 && input.length === 0;

  const CODE_MODE_HINT: Record<PtcMode, string> = {
    native: '原生工具调用',
    ptc: '模型只见 run_code，其余工具以 TS 程序编排',
    both: 'run_code 与原生调用并存',
  };

  async function toggleCodeMode(): Promise<void> {
    const order: PtcMode[] = ['native', 'ptc', 'both'];
    const next = order[(order.indexOf(codeMode) + 1) % order.length] ?? 'native';
    if (next !== 'native' && !codeRuntimeAvailable()) {
      pushBlock([
        `${YELLOW}  ${codeModeLabel(next)}模式需要 Node ≥ 22.19（当前 ${process.version} 不支持类型剥离）${RESET}`,
      ]);
      return;
    }
    modeSwitching = true;
    const prev = codeMode;
    codeMode = next;
    scheduleRender();
    try {
      // 不往历史区打反馈行：状态栏的模式标会即时变化（PTC/混合高亮），
      // 每按一次 Tab 记一行，连按几下就把同一信息刷满屏幕。
      await rebuildHost();
    } catch (err) {
      // activate() 在 next host 上抛错：host/hooks 还没换，回滚模式即可。
      codeMode = prev;
      pushBlock([
        `${RED}  ✗ 模式切换失败：${err instanceof Error ? err.message : String(err)}${RESET}`,
        `${DIM}  已保持${codeModeLabel(prev)}模式${RESET}`,
      ]);
    } finally {
      modeSwitching = false;
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
        pushBlock([`  ${BOLD}命令${RESET}`, ...lines]);
        return true;
      }
      case '/model': {
        try {
          const models = await fetchModelList();
          if (models.length === 0) {
            pushBlock([`${DIM}  站点未返回任何模型${RESET}`]);
          } else {
            // Interactive picker overlay (↑↓ Enter Esc), not a history dump.
            const current = models.indexOf(client.model);
            modelPicker = { models, index: Math.max(0, current) };
            scheduleRender();
          }
        } catch (err) {
          pushBlock([`${RED}  模型列表获取失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
        }
        return true;
      }
      case '/approvals': {
        const idx = APPROVAL_ORDER.indexOf(permission.approvalMode);
        const next = APPROVAL_ORDER[(idx + 1) % APPROVAL_ORDER.length] ?? 'read-only';
        permission.setMode(next);
        pushBlock([`${DIM}  审批档位：${approvalLabel(next)}${RESET}`]);
        return true;
      }
      case '/mode': {
        pushBlock([
          `  ${BOLD}执行模式${RESET} ${DIM}· 新会话未开始时按 Tab 循环切换${RESET}`,
          ...(['native', 'ptc', 'both'] as PtcMode[]).map((m) =>
            m === codeMode
              ? `  ${CYAN}${BOLD}❯ ${padDisplay(codeModeLabel(m), 6)}${RESET} ${CODE_MODE_HINT[m]}`
              : `    ${padDisplay(codeModeLabel(m), 6)} ${DIM}${CODE_MODE_HINT[m]}${RESET}`,
          ),
          `${DIM}  模式决定工具集呈现方式；会话一旦跑起来工具集保持稳定，切换只对新会话生效${RESET}`,
        ]);
        return true;
      }
      case '/plugins': {
        const lines = host.toolEntries.map(
          (entry) => `${DIM}  插件=${entry.plugin} · 工具=${entry.tool.name} · 权限=${permissionLabel(entry.permission)}${RESET}`,
        );
        pushBlock([`  ${BOLD}插件与工具${RESET}`, ...lines]);
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
        pushBlock([
          `  ${BOLD}会话${RESET}`,
          `${DIM}  文件 ${session.file}${RESET}`,
          `${DIM}  消息 ${messages.length} 条 · 日志事件 ${session.events.length} 条 · ${stats.turns} 轮${RESET}`,
          `${DIM}  输入 ${stats.promptTokens} tok（缓存 ${hit}%${lastHit !== null ? ` · 上轮 ${lastHit}%` : ''}）· 输出 ${stats.completionTokens} tok${RESET}`,
          `${DIM}  缓存浪费 ${stats.missTokens} tok · 超噪声底轮次 ${stats.missTurns}${RESET}`,
          `${DIM}  自动压缩 ${compact}${RESET}`,
          `  ${BOLD}模型${RESET} ${client.model}`,
          currentModelMeta !== undefined
            ? `${DIM}  ${formatModelMeta(currentModelMeta)}（models.dev · ${currentModelMeta.provider}）${RESET}`
            : `${DIM}  元数据未命中（离线或目录没有该模型；可配 provider.contextWindow 兜底）${RESET}`,
          `${DIM}  执行模式 ${codeModeLabel(codeMode)}${RESET}`,
          `${DIM}  ${contextLegend(paint, contextBreakdown(contextView()).segments.filter((s) => s.tokens > 0))}${RESET}`,
        ]);
        try {
          const entries = await listRecentSessions(sessionsRoot(), SESSION_LIST_LIMIT);
          if (entries.length > 0) {
            sessionPicker = {
              entries,
              index: Math.max(0, entries.findIndex((entry) => entry.file === session.file)),
            };
            scheduleRender();
          }
        } catch (err) {
          pushBlock([`${RED}  ✗ 会话列表读取失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
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
        await seedContextFragment();
        pushBlock([`${DIM}  新会话：${session.file}${RESET}`]);
        return true;
      }
      case '/compact': {
        pushBlock([`${DIM}  ⋯ 正在压缩会话…${RESET}`]);
        try {
          const outcome = await runCompact('manual');
          pushBlock([
            `${GREEN}  ✓ 已压缩${RESET} ${DIM}· 摘要 ${outcome.summary.length} 字 · 保留 ${outcome.retained} 条最近消息${RESET}`,
          ]);
        } catch (err) {
          pushBlock([`${RED}  ✗ 压缩失败：${err instanceof Error ? err.message : String(err)}${RESET}`], {
            first: '',
            rest: '      ',
          });
        }
        return true;
      }
      case '/clear': {
        blocks.length = 0;
        toolBlocks.clear();
        closeReadGroup();
        reasoningBlock = undefined;
        scrollFromEnd = 0;
        pushBlock([`${DIM}  （已清空显示，会话记录保留在磁盘）${RESET}`]);
        return true;
      }
      case '/init': {
        const file = await writeAgentsMd(rootDir);
        pushBlock([`${GREEN}  已写入 ${path.basename(file)}${RESET}`]);
        return true;
      }
      default:
        pushBlock([`${RED}  未知命令：${cmd}${RESET} ${DIM}（输入 /help 查看命令）${RESET}`]);
        return true;
    }
  }

  /**
   * Switch the live conversation to a past session: rebind the append-only
   * log, restore the model-visible surface, and replay user/assistant text
   * into a fresh transcript (tool traffic stays in the log, not re-rendered).
   */
  async function switchToSession(entry: SessionEntry): Promise<void> {
    if (streaming || compactRunning) {
      pushBlock([`${YELLOW}  当前轮未结束：先 Esc 中断，再切换会话${RESET}`]);
      scheduleRender();
      return;
    }
    let loaded: Session;
    try {
      loaded = await Session.open(entry.file);
    } catch (err) {
      pushBlock([`${RED}  ✗ 会话读取失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
      scheduleRender();
      return;
    }
    const restored = loaded.deriveMessages();
    session = loaded;
    messages = restored;
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
    toolBlocks.clear();
    closeReadGroup();
    reasoningBlock = undefined;
    activeToolId = undefined;
    blocks.length = 0;
    scrollFromEnd = 0;
    // Follow the session back to the workspace it was created in, so the
    // restored context fragment and the tools' root agree again.
    let workspaceLine: string | undefined;
    const target = sessionWorkspace(loaded);
    if (target !== undefined && target !== rootDir) {
      if (existsSync(target)) {
        await applyWorkspace(target);
        workspaceLine = `${GREEN}  ✓ 工作区已切换${RESET} ${DIM}${target}${RESET}`;
      } else {
        workspaceLine = `${YELLOW}  ⚠ 原工作区已不存在：${target}${RESET} ${DIM}（工具仍指向 ${rootDir}）${RESET}`;
      }
    }
    for (const m of restored) {
      if (m.role === 'user') {
        if (m.content.trimStart().startsWith('<')) continue;
        pushBlock(['', m.content], { first: `  ${CYAN}${BOLD}❯${RESET} ${BOLD}`, rest: `    ${BOLD}` });
      } else if (m.role === 'assistant' && m.content.trim().length > 0) {
        pushBlock([m.content], { first: `  ${DIM}•${RESET} `, rest: '    ' });
      }
    }
    pushBlock([
      `${GREEN}  ✓ 已切换到会话${RESET} ${DIM}${path.basename(loaded.file)} · 上下文 ${restored.length} 条消息${RESET}`,
    ]);
    if (workspaceLine !== undefined) pushBlock([workspaceLine]);
    scheduleRender();
  }

  // ---- input handling ---------------------------------------------------
  /**
   * Commands that are safe to run WHILE a turn is streaming: read-only
   * queries and global switches. In particular /approvals must work mid-turn
   * — switching the gate mode while the agent works is the whole point.
   * Session-mutating commands (/new /compact /clear /init) stay blocked.
   */
  const STREAM_SAFE_COMMANDS = new Set(['/approvals', '/help', '/model', '/session', '/plugins', '/exit', '/quit']);

  async function handleSubmit(): Promise<void> {
    const text = input.trim();
    if (streaming || compactRunning) {
      const cmd = text.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (STREAM_SAFE_COMMANDS.has(cmd)) {
        input = '';
        cursorPos = 0;
        popupIndex = 0;
        void runCommand(text)
          .catch((err: unknown) => {
            pushBlock([`${RED}  ✗ 命令失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
            scheduleRender();
          })
          .then(() => scheduleRender());
        return;
      }
      pushBlock([
        `${DIM}  上一轮仍在进行：Esc 中断当前轮；/approvals /model /session /plugins 等查看类命令仍可用${RESET}`,
      ]);
      scheduleRender();
      return;
    }
    input = '';
    cursorPos = 0;
    popupIndex = 0;
    if (text.length === 0) {
      scheduleRender();
      return;
    }
    historyIdx = -1;
    historyStack.push(text);
    if (historyStack.length > 200) historyStack.shift();

    let effective = text;
    const skillInvocation = await expandSkillInvocation(effective, skills);
    if (skillInvocation !== undefined) {
      if (!skillInvocation.ok) {
        pushBlock([`${RED}  ${skillInvocation.error}${RESET}`]);
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
          pushBlock([`${RED}  ✗ 命令失败：${err instanceof Error ? err.message : String(err)}${RESET}`]);
          scheduleRender();
        })
        .then(() => scheduleRender());
      return;
    }
    scrollFromEnd = 0;
    void agentTurn(effective);
  }

  function handleKey(k: Key): void {
    // approval modal swallows keys while open
    if (approvalRequest !== undefined) {
      const resolve = (answer: 'allow' | 'deny' | 'always'): void => {
        approvalRequest?.resolve(answer);
        approvalRequest = undefined;
        approvalPreview = undefined;
      };
      if (k.type === 'ctrl+c') {
        resolve('deny');
        aborters.at(-1)?.abort();
        scheduleRender();
        return;
      }
      // Codex-style selection: move with arrows, confirm with Enter. The
      // y/a/n keys remain as shortcuts, 1/2/3 jump to an option.
      if (k.type === 'up') approvalIndex = Math.max(0, approvalIndex - 1);
      else if (k.type === 'down') approvalIndex = Math.min(APPROVAL_CHOICES.length - 1, approvalIndex + 1);
      else if (k.type === 'enter') {
        resolve(APPROVAL_CHOICES[approvalIndex] ?? 'deny');
      } else if (k.type === 'char') {
        if (k.ch === 'y' || k.ch === 'Y') resolve('allow');
        else if (k.ch === 'a' || k.ch === 'A') resolve('always');
        else if (k.ch === 'n' || k.ch === 'N') resolve('deny');
        else if (k.ch === '1') approvalIndex = 0;
        else if (k.ch === '2') approvalIndex = 1;
        else if (k.ch === '3') approvalIndex = 2;
      } else if (k.type === 'esc') {
        resolve('deny');
      }
      scheduleRender();
      return;
    }

    // model picker swallows keys while open (↑↓ scroll · Enter switch · Esc cancel)
    if (modelPicker !== undefined) {
      const picker = modelPicker;
      const winSize = Math.min(MODEL_PICKER_WINDOW, picker.models.length);
      if (k.type === 'ctrl+c' || k.type === 'esc') {
        modelPicker = undefined;
      } else if (k.type === 'up') {
        picker.index = Math.max(0, picker.index - 1);
      } else if (k.type === 'down') {
        picker.index = Math.min(picker.models.length - 1, picker.index + 1);
      } else if (k.type === 'pageup') {
        picker.index = Math.max(0, picker.index - winSize);
      } else if (k.type === 'pagedown') {
        picker.index = Math.min(picker.models.length - 1, picker.index + winSize);
      } else if (k.type === 'wheelup') {
        picker.index = Math.max(0, picker.index - 1);
      } else if (k.type === 'wheeldown') {
        picker.index = Math.min(picker.models.length - 1, picker.index + 1);
      } else if (k.type === 'enter') {
        const model = picker.models[picker.index];
        modelPicker = undefined;
        if (model !== undefined && model !== client.model) {
          client.setModel(model);
          pushBlock([`${DIM}  模型已切换为 ${model}${RESET}`]);
          void refreshModelMeta();
        } else if (model !== undefined) {
          pushBlock([`${DIM}  已是当前模型：${model}${RESET}`]);
        }
      } else {
        return; // any other key: swallowed by the picker, never reaches the composer
      }
      scheduleRender();
      return;
    }

    // session picker swallows keys while open (↑↓ scroll · Enter switch · Esc cancel)
    if (sessionPicker !== undefined) {
      const picker = sessionPicker;
      const winSize = Math.min(SESSION_PICKER_WINDOW, picker.entries.length);
      if (k.type === 'ctrl+c' || k.type === 'esc') {
        sessionPicker = undefined;
      } else if (k.type === 'up' || k.type === 'wheelup') {
        picker.index = Math.max(0, picker.index - 1);
      } else if (k.type === 'down' || k.type === 'wheeldown') {
        picker.index = Math.min(picker.entries.length - 1, picker.index + 1);
      } else if (k.type === 'pageup') {
        picker.index = Math.max(0, picker.index - winSize);
      } else if (k.type === 'pagedown') {
        picker.index = Math.min(picker.entries.length - 1, picker.index + winSize);
      } else if (k.type === 'enter') {
        const entry = picker.entries[picker.index];
        sessionPicker = undefined;
        if (entry !== undefined && entry.file !== session.file) {
          void switchToSession(entry);
        } else if (entry !== undefined) {
          pushBlock([`${DIM}  已是当前会话${RESET}`]);
        }
      } else {
        return;
      }
      scheduleRender();
      return;
    }

    if (k.type === 'ctrl+c') {
      if (streaming) {
        interruptAt = Date.now();
        aborters.at(-1)?.abort();
        scheduleRender();
        return;
      }
      if (input.length > 0) {
        input = '';
        cursorPos = 0;
        scheduleRender();
        return;
      }
      const now = Date.now();
      if (now - lastCtrlC < 2000) {
        exitApp();
        return;
      }
      lastCtrlC = now;
      scheduleRender();
      return;
    }
    if (k.type === 'ctrl+d') {
      if (!streaming) exitApp();
      return;
    }
    if (k.type === 'esc' && streaming) {
      interruptAt = Date.now();
      aborters.at(-1)?.abort();
      scheduleRender();
      return;
    }

    const popupMatches = commandPopupMatches();

    switch (k.type) {
      case 'enter': {
        if (popupMatches.length > 0) {
          const selected = popupMatches[Math.min(popupIndex, popupMatches.length - 1)];
          if (selected !== undefined) {
            // 回车直接执行选中的命令（codex 面板语义），不再"补全加空格等
            // 二次回车"。带参数的命令用 Tab 补全：一旦输入空格面板即关闭
            // （filterCommands 只匹配裸命令），参数不会被丢弃。
            input = selected.name;
            cursorPos = input.length;
            void handleSubmit();
          }
          break;
        }
        void handleSubmit();
        break;
      }
      case 'tab': {
        if (popupMatches.length > 0) {
          const selected = popupMatches[Math.min(popupIndex, popupMatches.length - 1)];
          if (selected !== undefined) {
            input = `${selected.name} `;
            cursorPos = input.length;
          }
        } else if (sessionPristine()) {
          // 新会话未开始：Tab 循环 普通 → PTC → 混合 执行模式。
          void toggleCodeMode();
        }
        break;
      }
      case 'esc':
        popupDismissed = true;
        popupIndex = 0;
        break;
      case 'up': {
        if (popupMatches.length > 0) {
          popupIndex = Math.max(0, popupIndex - 1);
          break;
        }
        // Multi-line input: arrows walk the wrapped rows (visual column kept),
        // not the prompt history — history returns once the input is one line.
        if (input.includes('\n')) {
          cursorPos = cursorAfterVerticalMove(input, cursorPos, composerWrapBudget(screen.cols), -1);
          break;
        }
        if (historyIdx === -1) {
          historyDraft = input;
          historyIdx = historyStack.length - 1;
        } else if (historyIdx > 0) {
          historyIdx -= 1;
        }
        if (historyIdx >= 0) {
          input = historyStack[historyIdx] ?? '';
          cursorPos = input.length;
        }
        break;
      }
      case 'down': {
        if (popupMatches.length > 0) {
          popupIndex = Math.min(popupMatches.length - 1, popupIndex + 1);
          break;
        }
        if (input.includes('\n')) {
          cursorPos = cursorAfterVerticalMove(input, cursorPos, composerWrapBudget(screen.cols), 1);
          break;
        }
        if (historyIdx >= 0) {
          historyIdx += 1;
          if (historyIdx >= historyStack.length) {
            historyIdx = -1;
            input = historyDraft;
          } else {
            input = historyStack[historyIdx] ?? '';
          }
          cursorPos = input.length;
        }
        break;
      }
      case 'pageup':
        scrollFromEnd = Math.min(scrollFromEnd + Math.max(3, screen.rows - 6), totalWrappedLines());
        scheduleRender();
        return;
      case 'pagedown':
        scrollFromEnd = Math.max(0, scrollFromEnd - Math.max(3, screen.rows - 6));
        scheduleRender();
        return;
      case 'wheelup':
        // Wheel notch ≈ 3 lines; paint synchronously so scrolling feels
        // attached to the wheel instead of lagging a frame behind.
        scrollFromEnd = Math.min(scrollFromEnd + 3, totalWrappedLines());
        preemptRender();
        return;
      case 'wheeldown':
        scrollFromEnd = Math.max(0, scrollFromEnd - 3);
        preemptRender();
        return;
      case 'left':
        cursorPos = Math.max(0, cursorPos - 1);
        break;
      case 'right':
        cursorPos = Math.min(input.length, cursorPos + 1);
        break;
      case 'home':
        cursorPos = 0;
        break;
      case 'end':
        cursorPos = input.length;
        break;
      case 'backspace':
        if (cursorPos > 0) {
          input = input.slice(0, cursorPos - 1) + input.slice(cursorPos);
          cursorPos -= 1;
        }
        popupDismissed = false;
        break;
      case 'delete':
        input = input.slice(0, cursorPos) + input.slice(cursorPos + 1);
        popupDismissed = false;
        break;
      case 'ctrl+u':
        input = input.slice(cursorPos);
        cursorPos = 0;
        popupDismissed = false;
        break;
      case 'ctrl+w': {
        const before = input.slice(0, cursorPos).trimEnd();
        const cut = before.lastIndexOf(' ');
        input = (cut >= 0 ? before.slice(0, cut + 1) : '') + input.slice(cursorPos);
        cursorPos = cut >= 0 ? cut + 1 : 0;
        popupDismissed = false;
        break;
      }
      case 'char':
        input = input.slice(0, cursorPos) + k.ch + input.slice(cursorPos);
        cursorPos += k.ch.length;
        popupDismissed = false;
        break;
      case 'paste': {
        // Multi-line paste stays multi-line (the composer soft-wraps it);
        // other control characters are dropped — a pasted escape sequence
        // must never reach the UI. Tabs become spaces so no raw \t can
        // corrupt a rendered row.
        let cleaned = k.text
          .replace(/\r\n?/g, '\n')
          // eslint-disable-next-line no-control-regex
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
          .replaceAll('\t', '  ');
        let truncated = false;
        if (cleaned.length > PASTE_MAX_CHARS) {
          cleaned = cleaned.slice(0, PASTE_MAX_CHARS);
          truncated = true;
        }
        if (cleaned.length > 0) {
          input = input.slice(0, cursorPos) + cleaned + input.slice(cursorPos);
          cursorPos += cleaned.length;
          popupDismissed = false;
        }
        if (truncated) {
          pushBlock([`${DIM}  （粘贴内容超过 ${PASTE_MAX_CHARS} 字符，已截断）${RESET}`]);
        }
        break;
      }
    }
    scheduleRender();
  }

  function totalWrappedLines(): number {
    let total = 0;
    for (const block of blocks) {
      total += wrapBlock(block).length;
    }
    return total;
  }

  function wrapBlock(block: Block): string[] {
    if (block.wrapped === undefined) {
      if (block.gutter === undefined) {
        // Wrap one column short of the terminal width: the renderer keeps the
        // last column as a no-write safety margin.
        block.wrapped = block.lines.flatMap((line) => wrapLine(line, screen.cols - 1));
      } else {
        // Gutter blocks wrap at the continuation width so soft-wrapped rows
        // align under the block's first content column.
        const rest = block.gutter.rest;
        const budget = Math.max(10, screen.cols - 1 - styledWidth(rest));
        const rows: string[] = [];
        let firstSeen = false;
        for (const line of block.lines) {
          for (const row of wrapLine(line, budget)) {
            if (row.length === 0) {
              rows.push('');
              continue;
            }
            rows.push((firstSeen ? rest : block.gutter.first) + row);
            firstSeen = true;
          }
        }
        block.wrapped = rows;
      }
    }
    return block.wrapped;
  }

  // ---- rendering --------------------------------------------------------
  function renderFrame(): void {
    if (exiting) return;
    const cols = screen.cols;
    const rows = screen.rows;

    const matches = commandPopupMatches();
    const popupOpen =
      approvalRequest === undefined &&
      modelPicker === undefined &&
      sessionPicker === undefined &&
      matches.length > 0;
    // Sliding 6-row window: the highlighted entry stays visible even when the
    // match list is longer than the popup.
    const visibleStart = Math.max(0, Math.min(popupIndex - 5, matches.length - 6));
    const visibleMatches = matches.slice(visibleStart, visibleStart + 6);

    const popupLines: string[] = [];
    if (approvalRequest !== undefined) {
      // 弹窗行折行会把整体顶出视口：头部与 diff 预览都按剩余列数裁剪（纯
      // 构建器在 ./popup.ts，键交互留在 handleKey 的责任链层）。
      popupLines.push(
        ...buildApprovalPopup(
          paint,
          {
            permissionLabel: permissionLabel(approvalRequest.kind),
            toolLabel: toolLabel(approvalRequest.call.name),
            argSummary: toolArgSummary(approvalRequest.call.name, approvalRequest.call.rawArgs, 100),
            previewLines: approvalPreview,
            index: approvalIndex,
          },
          cols,
        ),
      );
    } else if (modelPicker !== undefined) {
      // Model catalog in a bordered panel with a sliding window: long lists
      // scroll inside the popup instead of flooding the transcript.
      popupLines.push(
        ...buildModelPopup(
          paint,
          {
            items: modelPicker.models.map((name) => ({
              name,
              contextTokens: modelMetaStore.peek(name, config.provider.baseURL)?.contextWindow,
            })),
            index: modelPicker.index,
            current: client.model,
          },
          cols,
        ),
      );
    } else if (sessionPicker !== undefined) {
      // Session switcher: bordered panel like the model picker, a sliding
      // window over the newest sessions, current one marked.
      popupLines.push(
        ...buildSessionPopup(
          paint,
          {
            items: sessionPicker.entries.map((entry) => ({
              mtime: entry.mtime,
              title: entry.title,
              isCurrent: entry.file === session.file,
            })),
            index: sessionPicker.index,
          },
          cols,
        ),
      );
    } else if (popupOpen && visibleMatches.length > 0) {
      // Bordered dropdown matching the composer box; the selected row is
      // inverse-video across the full row width, not just the label.
      popupLines.push(...buildCommandPopup(paint, { matches: visibleMatches, index: popupIndex }, cols));
    }

    // One breathing row between the newest content and the composer.
    const breatheRows = 1;
    const layout = layoutComposer(input, cursorPos, composerWrapBudget(cols), COMPOSER_MAX_ROWS);
    const composerZoneRows = composerZone(paint, layout, { spinnerFrame, streaming, genPhase });
    // 单行状态区：上下文仪表+模型+模式芯片+审批 ｜ tps+cache 钉右缘。
    const statusRows = 1;
    const historyRows = Math.max(
      3,
      rows - popupLines.length - composerZoneRows.length - statusRows - breatheRows,
    );

    const flat: string[] = [];
    for (const block of blocks) flat.push(...wrapBlock(block));
    // The wheel/pageup handlers pre-cap at the transcript length, but the
    // viewport is only historyRows tall: once the offset passes
    // `flat.length - historyRows` an extra notch can't reveal earlier lines —
    // it just hides newest ones off a fixed top, erasing the transcript
    // bottom-up to a blank screen. Clamp here, where historyRows is known
    // (it shrinks while a popup is open, so the handlers can't know it).
    const maxScroll = Math.max(0, flat.length - historyRows);
    if (scrollFromEnd > maxScroll) scrollFromEnd = maxScroll;
    const sliceEnd = Math.max(0, flat.length - scrollFromEnd);
    const sliceStart = Math.max(0, sliceEnd - historyRows);
    let historyLines = flat.slice(sliceStart, sliceEnd);
    // Document-style top alignment: short transcripts read from the top of the
    // screen (banner first, content below) and the emptiness sits in the
    // middle — padding at the bottom. Once the transcript outgrows the
    // viewport the pad disappears and paging takes over.
    while (historyLines.length < historyRows) historyLines.push('');

    // 按显示宽裁剪：绝不折行顶动布局（statusBar 内部已做截左保右）。
    const status = clipToWidth(statusBar(paint, statusView()), cols - 1);

    // The breathing row separates history from the popup/composer zone.
    // Bottom stack: composer rows · single status line.
    screen.render(
      [...historyLines, '', ...popupLines, ...composerZoneRows, status],
      cursorPosition({ historyRows, popupRows: popupLines.length, layout }),
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
    streaming,
    interruptAt,
    inputEmpty: input.length === 0,
    lastCtrlC,
    now: Date.now(),
    tpsRing,
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
    // Wrapped caches were computed at the old width; rewrap everything.
    for (const block of blocks) block.wrapped = undefined;
    screen.invalidate();
    scheduleRender();
  });
  process.on('SIGINT', () => {
    if (streaming) {
      interruptAt = Date.now();
      aborters.at(-1)?.abort();
      scheduleRender();
    } else exitApp();
  });

  // run
  screen.enter();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  // models.dev 目录后台加载（磁盘缓存在即秒回）；到达后结构行自动换容量。
  void refreshModelMeta();

  // First screen: a content-sized bordered panel — the brand sits in the top
  // border (same title-in-border pattern as the popups), context rows first,
  // key hints last. Box glyphs measure 1 col (see width.ts), so the right
  // border lines up exactly. Skills and session warnings stay outside as
  // plain lines: they can be long and would blow the panel's width.
  const brand = `${CYAN}${BOLD}Nova${RESET} ${DIM}v0.1.0${RESET}`;
  // 工作区 is 3 CJK chars (6 cols), the others 2 (4) — pad to 8 so the value
  // column lines up across rows.
  const bannerRow = (label: string, value: string): string => ` ${padDisplay(label, 8)}${value}`;
  const bannerRows = [
    bannerRow('工作区', rootDir),
    bannerRow('会话', sessionsRoot()),
    bannerRow('提示', '/ 命令面板 · 新会话按 Tab 切模式 · Esc 中断 · Ctrl+C×2 退出'),
  ];
  const panelInner = Math.max(...bannerRows.map((r) => styledWidth(r) + 2), 14);
  const bannerLines: string[] = [
    `${DIM}╭─ ${RESET}${brand}${DIM} ${'─'.repeat(Math.max(0, panelInner - styledWidth(brand) - 3))}╮${RESET}`,
    ...bannerRows.map(
      (r) => `${DIM}│ ${r}${' '.repeat(Math.max(0, panelInner - styledWidth(r) - 2))} │${RESET}`,
    ),
    `${DIM}╰${'─'.repeat(panelInner)}╯${RESET}`,
  ];
  if (skills.length > 0) {
    bannerLines.push(`${DIM}  技能 ${skills.map((s) => s.name).join('、')}${RESET}`);
  }
  for (const warning of session.warnings) {
    bannerLines.push(`${YELLOW}  ${warning}${RESET}`);
  }
  pushBlock(bannerLines);

  await new Promise<void>((resolve) => {
    exitNow = resolve;
  });
  console.log(`会话已保存：${session.file}`);
}
