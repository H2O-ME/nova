import os from 'node:os';
import path from 'node:path';
import { KeyDecoder, LineScreen, styledWidth, wrapLine, type Key } from '@nova-agent/tui';
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  emptyStats,
  estimateNextPromptTokens,
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
  loadSkills,
  PermissionService,
  PluginHost,
  skillsPlugin,
  type ApprovalMode,
  type AskFn,
  type PermissionKind,
} from '@nova-agent/plugins';
import type { McpPlugin } from '@nova-agent/mcp';
import { collectProjectDocs, writeAgentsMd } from './agents-md.js';
import { compactSession, surfaceDivergence, type CompactedSession } from './compact.js';
import {
  COMMAND_SPECS,
  createModelListCache,
  filterCommands,
  type CommandSpec,
} from './commands.js';
import { NOVA_DIR, type Config } from './config.js';
import { buildContextFragment, declaredShell, expandSkillInvocation, type SessionEnvInfo } from './context.js';
import { createMarkdownRenderer, type MarkdownRenderer } from './markdown.js';
import { createNotifier } from './notify.js';
import { buildSystemPrompt } from './system-prompt.js';
import {
  approvalLabel,
  APPROVAL_ORDER,
  contextBar,
  cursorAfterVerticalMove,
  humanTokens,
  isFailureContent,
  isReadOnlyTool,
  layoutComposer,
  palette,
  permissionLabel,
  plainPalette,
  SPINNER_FRAMES,
  statusIndicator,
  statusLine,
  toolArgSummary,
  toolDoneLine,
  toolGroupLine,
  toolLabel,
  toolStartLine,
  type ComposerLayout,
  type ComposerRow,
  type StopKind,
} from './ui.js';

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
const INVERSE = '\x1b[7m';

/** Composer prompt prefix; the cursor column math depends on its width. */
const COMPOSER_PREFIX = `  ${CYAN}${BOLD}❯${RESET} `;
const COMPOSER_PREFIX_WIDTH = styledWidth(COMPOSER_PREFIX);

/** Composer 最多占用的屏幕行数；超出后窗口随光标滑动并显示上下提示。 */
const COMPOSER_MAX_ROWS = 8;
/** 单次粘贴的字符上限：超过即截断（防止一次超巨粘贴把输入区撑爆）。 */
const PASTE_MAX_CHARS = 200_000;

/** Reasoning display caps: committed lines kept, and the live line's tail. */
const REASONING_MAX_LINES = 6;
const REASONING_MAX_PARTIAL_CHARS = 600;

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

function padDisplay(text: string, width: number): string {
  const pad = Math.max(0, width - styledWidth(text));
  return text + ' '.repeat(pad);
}

export async function startTui(opts: TuiOptions): Promise<void> {
  const { rootDir, config } = opts;
  const paint = process.stdout.isTTY === true ? palette : plainPalette;
  const screen = new LineScreen(process.stdout);
  const decoder = new KeyDecoder();

  // ---- persistent state -------------------------------------------------
  const sessionsDir = path.join(rootDir, NOVA_DIR, 'sessions');
  let messages: AgentMessage[] = [];
  let session: Session;
  if (opts.resumeFile) {
    session = await Session.open(opts.resumeFile);
    messages = session.deriveMessages();
  } else {
    session = await Session.create(sessionsDir);
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
  const approvalMode = opts.approvalOverride ?? config.approval ?? 'read-only';

  const host = new PluginHost(rootDir);
  const bashConfig = config.tools?.bash;
  let mcpConfigError: string | undefined;
  for (const plugin of builtinPlugins({
    bash:
      bashConfig?.enabled === false
        ? false
        : {
            ...(bashConfig?.timeoutMs !== undefined ? { timeoutMs: bashConfig.timeoutMs } : {}),
            ...(bashConfig?.shellPath !== undefined ? { shellPath: bashConfig.shellPath } : {}),
          },
  })) {
    host.use(plugin);
  }

  const skills = await loadSkills([
    { dir: path.join(rootDir, NOVA_DIR, 'skills'), level: 'project' },
    { dir: path.join(os.homedir(), '.nova', 'skills'), level: 'user' },
  ]);
  if (skills.length > 0) host.use(skillsPlugin(skills));

  let mcp: McpPlugin | undefined;
  try {
    // The MCP module is imported dynamically: with no mcp.json (or no
    // servers) neither the module nor any connector ever loads or starts.
    const { loadMcpConfig, mcpPlugin } = await import('@nova-agent/mcp');
    const mcpConfig = await loadMcpConfig(rootDir);
    if (mcpConfig !== undefined && mcpConfig.servers.length > 0) {
      mcp = mcpPlugin({ servers: mcpConfig.servers });
    }
  } catch (err) {
    // Surface the error but keep the session usable without MCP.
    mcpConfigError = err instanceof Error ? err.message : String(err);
  }
  await host.activate();

  /**
   * MCP connects on demand: attached and connected at the first agent turn
   * (so a slow/failing server never blocks boot), with failed servers
   * retried on each later turn.
   */
  let mcpAttached = false;
  const ensureMcp = async (): Promise<void> => {
    if (mcp === undefined) return;
    if (!mcpAttached) {
      mcpAttached = true;
      host.use(mcp);
      await host.activate();
      return;
    }
    await mcp.ensureConnected();
  };

  const sessionEnv: SessionEnvInfo = {
    platform: process.platform,
    cwd: rootDir,
    // Must match the shell the bash tool really runs (invocation() resolution),
    // or the model writes commands for the wrong interpreter.
    shell: declaredShell(bashConfig?.shellPath),
    today: new Date().toISOString().slice(0, 10),
  };
  // AGENTS.md chain is session-stable by design; /init results land in the next session.
  const projectDocs = await collectProjectDocs(rootDir, process.cwd());
  const buildFragment = (): string => buildContextFragment(sessionEnv, config.systemPrompt, skills, projectDocs);
  /** Re-seed the context fragment when a fresh session starts (/new). */
  const seedContextFragment = async (): Promise<void> => {
    const seed: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content: buildFragment() };
    messages.push(seed);
    await session.append(seed);
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
  const hooks = host.agentHooks(permission);
  const systemPrompt = buildSystemPrompt();

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
  let modelPicker: { models: string[]; index: number } | undefined;
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
  const APPROVAL_CHOICES = ['allow', 'always', 'deny'] as const;
  let spinnerFrame = 0;
  let spinnerStartedAt = 0;
  let exitNow: (() => void) | undefined;
  let lastCtrlC = 0;

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

  const spinner = {
    start() {
      spinnerStartedAt = Date.now();
      spinnerTimer ??= setInterval(() => {
        spinnerFrame += 1;
        // Animate the bullet of every running tool block (codex-style
        // activity marker) — the frame also drives the composer verb. After
        // two seconds a live elapsed suffix appears so a slow command never
        // looks frozen (Claude Code's bash progress counter).
        const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? '•';
        const now = Date.now();
        for (const entry of toolBlocks.values()) {
          const elapsed = now - entry.startAt;
          const suffix = elapsed >= 2000 ? `${DIM} · ${Math.floor(elapsed / 1000)}s${RESET}` : '';
          const lines = [toolStartLine(paint, entry.name, entry.rawArgs, frame) + suffix];
          // Live output tail for streaming tools (bash): the last line of
          // whatever the process has printed so far. This is what keeps a
          // 2-minute pnpm install from looking like a hang.
          const tailBuf = entry.tailBuf;
          if (tailBuf !== undefined) {
            const last = tailBuf.slice(tailBuf.lastIndexOf('\n') + 1).trimEnd().slice(-160);
            if (last.length > 0) lines.push(`      ${DIM}└ ${last}${RESET}`);
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
    try {
      // Lazy MCP: connect (or retry failed servers) before the first request.
      try {
        await ensureMcp();
      } catch {
        // MCP tools are simply unavailable this turn; the error shows in /mcp.
      }
      for await (const event of runAgent({
        provider: client,
        messages,
        rootDir,
        // Spilled tool outputs are grouped per session.
        cacheDir: path.join(rootDir, NOVA_DIR, 'cache', 'tool-outputs', session.id),
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
            if (!assistantOpen) {
              // Whitespace-only leading deltas (models often emit blank lines
              // before tool calls) must not anchor a blank answer block above
              // the tool lines — skip them until real content arrives.
              if (text.trim().length === 0) return;
              assistantOpen = true;
              assistantText = '';
              assistantBlock = undefined;
              reasoningOpen = false;
              closeReadGroup();
              discardReasoning();
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
            if (assistantOpen) return;
            if (!reasoningOpen) {
              reasoningOpen = true;
              reasoningDone.length = 0;
              reasoningPartial = '';
              pushBlock([], { first: '  ', rest: '    ' });
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
            const lines = [...reasoningDone, `${DIM}⋯ ${reasoningPartial}${RESET}`];
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
            discardReasoning();
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
            discardReasoning();
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
        // A new non-read call ends the current read-only group.
        if (!isReadOnlyTool(event.call.name)) closeReadGroup();
        const block: Block = {
          lines: [toolStartLine(paint, event.call.name, event.call.rawArgs)],
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
          const raw = toolArgSummary(event.call.name, event.call.rawArgs);
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
            toolGroupLine(paint, readGroup.entries, Date.now() - readGroup.startAt),
          ]);
        } else {
          closeReadGroup();
          const lines = toolDoneLine(paint, event.call.name, event.call.rawArgs, event.result.content, duration);
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
        closeReadGroup();
        io.foldReasoning();
        // A normal completion ends at the reply — no per-turn stats line (the
        // status bar carries tokens; /session carries details). Only abnormal
        // stops get a visible marker.
        if (event.stopReason !== 'complete') {
          const kind: StopKind = event.stopReason;
          pushBlock([statusLine(paint, kind, stats, Date.now() - startedAt)]);
        }
        break;
      }
    }
  }

  // ---- commands ---------------------------------------------------------
  async function runCommand(raw: string): Promise<boolean> {
    const [cmd = ''] = raw.trim().split(/\s+/);
    switch (cmd) {
      case '/exit':
      case '/quit':
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
        ]);
        return true;
      }
      case '/new': {
        session = await Session.create(sessionsDir);
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
        await seedContextFragment();
        pushBlock([`${DIM}  新会话：${session.file}${RESET}`]);
        return true;
      }
      case '/mcp': {
        if (mcp === undefined) {
          pushBlock([`${DIM}  未配置 MCP 服务器（.nova/mcp.json）${RESET}`]);
          return true;
        }
        const statuses = mcp.status();
        if (statuses.length === 0) {
          pushBlock([`${DIM}  MCP 将在首次对话时按需连接${RESET}`]);
          return true;
        }
        const lines = statuses.map(
          (s) =>
            `${DIM}  ${s.server} · ${s.type} · ${s.ok ? `${s.tools} 个工具` : `启动失败：${s.error}`}${RESET}`,
        );
        pushBlock([`  ${BOLD}MCP 服务器${RESET}`, ...lines]);
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

  // ---- input handling ---------------------------------------------------
  async function handleSubmit(): Promise<void> {
    if (streaming || compactRunning) {
      pushBlock([`${DIM}  上一轮仍在进行，请先按 Esc 中断再发送${RESET}`]);
      return;
    }
    const text = input.trim();
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
        } else if (model !== undefined) {
          pushBlock([`${DIM}  已是当前模型：${model}${RESET}`]);
        }
      } else {
        return; // any other key: swallowed by the picker, never reaches the composer
      }
      scheduleRender();
      return;
    }

    if (k.type === 'ctrl+c') {
      if (streaming) {
        aborters.at(-1)?.abort();
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
      aborters.at(-1)?.abort();
      return;
    }

    const popupMatches = commandPopupMatches();

    switch (k.type) {
      case 'enter': {
        if (popupMatches.length > 0) {
          const selected = popupMatches[Math.min(popupIndex, popupMatches.length - 1)];
          if (selected !== undefined && input.trim() === selected.name) {
            void handleSubmit();
          } else if (selected !== undefined) {
            input = `${selected.name} `;
            cursorPos = input.length;
            popupIndex = 0;
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
          cursorPos = cursorAfterVerticalMove(input, cursorPos, composerAvailable(), -1);
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
          cursorPos = cursorAfterVerticalMove(input, cursorPos, composerAvailable(), 1);
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
    const popupOpen = approvalRequest === undefined && modelPicker === undefined && matches.length > 0;
    // Sliding 6-row window: the highlighted entry stays visible even when the
    // match list is longer than the popup.
    const visibleStart = Math.max(0, Math.min(popupIndex - 5, matches.length - 6));
    const visibleMatches = matches.slice(visibleStart, visibleStart + 6);

    const popupLines: string[] = [];
    if (approvalRequest !== undefined) {
      const summary = toolArgSummary(approvalRequest.call.name, approvalRequest.call.rawArgs, 100);
      popupLines.push(
        `  ${YELLOW}${BOLD}! 需要审批${RESET} ${DIM}[${permissionLabel(approvalRequest.kind)}]${RESET} ${toolLabel(approvalRequest.call.name)} ${DIM}${summary}${RESET}`,
      );
      const labels = ['允许一次', '总是允许', '拒绝'];
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i] ?? '';
        popupLines.push(i === approvalIndex ? `  ${CYAN}${BOLD}❯ ${label}${RESET}` : `    ${DIM}${label}${RESET}`);
      }
      popupLines.push(`  ${DIM}↑↓ 选择 · Enter 确认 · Esc 拒绝${RESET}`);
    } else if (modelPicker !== undefined) {
      // Model catalog in a bordered panel with a sliding window: long lists
      // scroll inside the popup instead of flooding the transcript.
      const models = modelPicker.models;
      const winSize = Math.min(MODEL_PICKER_WINDOW, models.length);
      const start = Math.max(0, Math.min(modelPicker.index - (MODEL_PICKER_WINDOW - 1), models.length - winSize));
      const inner = cols - 3;
      popupLines.push(`╭─ ${DIM}模型${RESET} ${'─'.repeat(Math.max(0, inner - styledWidth('─ 模型 ')))}╮`);
      for (let i = 0; i < winSize; i++) {
        const idx = start + i;
        const name = models[idx] ?? '';
        const content = ` ${idx === modelPicker.index ? '❯' : ' '} ${idx + 1}. ${name}${name === client.model ? '（当前）' : ''}`;
        const pad = Math.max(0, inner - 2 - styledWidth(content));
        popupLines.push(
          idx === modelPicker.index
            ? `│ ${INVERSE}${content}${' '.repeat(pad)}${RESET} │`
            : `│ ${DIM}${content}${' '.repeat(pad)}${RESET} │`,
        );
      }
      popupLines.push(
        `╰${DIM}↑↓ 选择 · Enter 切换 · Esc 取消${RESET}${'─'.repeat(
          Math.max(0, inner - styledWidth('↑↓ 选择 · Enter 切换 · Esc 取消')),
        )}╯`,
      );
    } else if (popupOpen && visibleMatches.length > 0) {
      // Bordered dropdown matching the composer box; the selected row is
      // inverse-video across the full row width, not just the label.
      const inner = cols - 3;
      popupLines.push(`╭─ ${DIM}命令${RESET} ${'─'.repeat(Math.max(0, inner - styledWidth('─ 命令 ')))}╮`);
      for (let i = 0; i < visibleMatches.length; i++) {
        const spec = visibleMatches[i];
        if (spec === undefined) continue;
        const label = padDisplay(spec.usage, 22);
        const content = ` ${label} ${spec.description}`;
        const pad = Math.max(0, inner - 2 - styledWidth(content));
        const selected = visibleStart + i === popupIndex;
        popupLines.push(
          selected
            ? `│ ${INVERSE}${content}${' '.repeat(pad)}${RESET} │`
            : `│ ${DIM}${content}${' '.repeat(pad)}${RESET} │`,
        );
      }
      popupLines.push(
        `╰${DIM}↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭${RESET}${'─'.repeat(
          Math.max(0, inner - styledWidth('↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭')),
        )}╯`,
      );
    }

    // One breathing row between the newest content and the composer.
    const breatheRows = 1;
    const layout = layoutComposer(input, cursorPos, composerAvailable(), COMPOSER_MAX_ROWS);
    const composerZoneRows = composerZone(layout);
    const statusRows = 1;
    const historyRows = Math.max(
      3,
      rows - popupLines.length - composerZoneRows.length - statusRows - breatheRows,
    );

    const flat: string[] = [];
    for (const block of blocks) flat.push(...wrapBlock(block));
    const sliceEnd = Math.max(0, flat.length - scrollFromEnd);
    const sliceStart = Math.max(0, sliceEnd - historyRows);
    let historyLines = flat.slice(sliceStart, sliceEnd);
    // Document-style top alignment: short transcripts read from the top of the
    // screen (banner first, content below) and the emptiness sits in the
    // middle — padding at the bottom. Once the transcript outgrows the
    // viewport the pad disappears and paging takes over.
    while (historyLines.length < historyRows) historyLines.push('');

    const status = statusBarLine();

    // The breathing row separates history from the popup/composer zone.
    screen.render(
      [...historyLines, '', ...popupLines, ...composerZoneRows, status],
      cursorPosition(historyRows, layout),
    );
  }

  /** Wrap budget inside the composer: prompt prefix + right margin + caret cell. */
  const composerAvailable = (): number => Math.max(1, screen.cols - COMPOSER_PREFIX_WIDTH - 2);

  /**
   * The composer zone: up to COMPOSER_MAX_ROWS wrapped input rows between
   * optional "more above/below" hints. The first visible row carries the
   * `❯` prompt; continuation rows align under it.
   */
  function composerZone(layout: ComposerLayout): string[] {
    const zone: string[] = [];
    if (layout.hiddenAbove > 0) zone.push(`  ${DIM}⋯ 上方还有 ${layout.hiddenAbove} 行${RESET}`);
    const indent = ' '.repeat(COMPOSER_PREFIX_WIDTH);
    layout.rows.forEach((row, i) => {
      const lead = i === 0 && layout.hiddenAbove === 0 ? COMPOSER_PREFIX : indent;
      zone.push(lead + renderComposerRow(row));
    });
    if (layout.hiddenBelow > 0) zone.push(`  ${DIM}⋯ 下方还有 ${layout.hiddenBelow} 行${RESET}`);
    return zone;
  }

  /** One input row; the caret renders as an inverse block on the char it sits on. */
  function renderComposerRow(row: ComposerRow): string {
    if (row.caretIdx < 0) return row.text;
    const rest = row.text.slice(row.caretIdx);
    const at = [...rest][0] ?? ' ';
    return `${row.text.slice(0, row.caretIdx)}${INVERSE}${at}${RESET}${rest.slice(at.length)}`;
  }

  function popupHeight(): number {
    if (approvalRequest !== undefined) return 5; // header + 3 options + hint
    if (modelPicker !== undefined) {
      return Math.min(MODEL_PICKER_WINDOW, modelPicker.models.length) + 2; // rows + title + hint border
    }
    const matches = commandPopupMatches();
    if (matches.length === 0) return 0;
    // title + rows + hint bottom border
    return Math.min(6, matches.length) + 2;
  }

  function cursorPosition(historyRows: number, layout: ComposerLayout): { row: number; col: number } {
    // Layout: history · breathe · popup · composer zone · status. The caret
    // row sits inside the zone; the "more above" hint (when present) occupies
    // the zone's first row and shifts everything down one.
    const hintRows = layout.hiddenAbove > 0 ? 1 : 0;
    return {
      row: historyRows + popupHeight() + hintRows + layout.cursorRow,
      col: COMPOSER_PREFIX_WIDTH + layout.cursorCol,
    };
  }

  function statusBarLine(): string {
    const hit = stats.promptTokens > 0 ? Math.round((stats.cachedTokens / stats.promptTokens) * 100) : 0;
    const parts: string[] = [];
    // Streaming indicator lives in the status bar now (the composer is a
    // single prompt row and has no title strip for it).
    if (streaming) {
      const elapsed = spinnerStartedAt === 0 ? 0 : Date.now() - spinnerStartedAt;
      const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? '•';
      parts.push(`${frame} ${statusIndicator(true, elapsed, spinnerFrame)}`);
    }
    // Scrolled-away indicator: the viewport is anchored while scrolled up and
    // new output keeps arriving below — without this marker the screen just
    // looks frozen, with no hint that ↓ returns to the live tail.
    if (scrollFromEnd > 0) parts.push(`${CYAN}已上滚 ${scrollFromEnd} 行 · ↓/滚轮到底${RESET}`);
    if (!streaming && input.length === 0 && Date.now() - lastCtrlC < 2000) {
      parts.push(`${YELLOW}再按一次 Ctrl+C 退出${RESET}`);
    }
    parts.push(
      `${BOLD}${client.model}${RESET}`,
      `审批 ${approvalLabel(permission.approvalMode)}`,
      `↑${humanTokens(stats.promptTokens)} ↓${humanTokens(stats.completionTokens)}`,
    );
    if (hit > 0) parts.push(`缓存 ${hit}%`);
    // Context pressure toward the auto-compact limit: a bar the user can read
    // at a glance, colored as it approaches the trip point.
    const limit = config.autoCompactTokenLimit;
    if (limit !== undefined && usageAnchor !== undefined) {
      const estimate = estimateNextPromptTokens(usageAnchor, messages.slice(anchorMsgCount));
      const ratio = estimate / limit;
      const color = ratio >= 1 ? RED : ratio >= 0.7 ? YELLOW : GREEN;
      parts.push(`ctx ${color}${contextBar(ratio)}${RESET}${DIM} ${Math.round(ratio * 100)}%`);
    }
    return `${DIM} ${parts.join(' · ')}${RESET}`;
  }

  // ---- lifecycle --------------------------------------------------------
  function exitApp(): void {
    if (exiting) return;
    exiting = true;
    spinner.stop();
    if (escTimer !== undefined) {
      clearTimeout(escTimer);
      escTimer = undefined;
    }
    if (mcp !== undefined) void mcp.close().catch(() => undefined);
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
    if (streaming) aborters.at(-1)?.abort();
    else exitApp();
  });

  // run
  screen.enter();
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const bannerLines = [
    `${CYAN}${BOLD}  Nova${RESET} ${DIM}v0.1.0${RESET}`,
    `${DIM}  ${rootDir} · / 命令面板 · Esc 中断 · Ctrl+C×2 退出${RESET}`,
  ];
  if (skills.length > 0) {
    bannerLines.push(`${DIM}  技能 ${skills.map((s) => s.name).join('、')}${RESET}`);
  }
  if (mcpConfigError !== undefined) {
    bannerLines.push(`${YELLOW}  MCP 配置加载失败：${mcpConfigError}${RESET}`);
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
