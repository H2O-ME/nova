/**
 * Turn projector: the per-turn transcript state machine that used to squat in
 * tui-mode's agentTurn closure (~15 mutable locals + io callbacks). Owns the
 * stream smoothing buffers, the assistant/reasoning block lifecycle
 * (open → reveal → fold / reset), tool-line morphs (pending → done / read
 * group), the running-tool line animation, subagent live rows, and the
 * abort/error teardown sequences.
 *
 * Timers stay in the shell (the projector never touches setInterval): deltas
 * call onNeedsReveal to arm the reveal tick, the shell pumps tick() and stops
 * when hasPendingReveal() goes false. Every block mutation goes through
 * TuiStore so the blocksVersion / onChange contracts keep holding. Tests
 * drive it with plainPalette, a fake clock and a stubbed onChange — no
 * terminal, no agent loop.
 */

import { styledWidth } from '@nova-agent/tui';
import {
  fitTail,
  isFailureContent,
  isReadOnlyTool,
  REASONING_FULL_MAX_CHARS,
  REASONING_LIVE_KEEP_CHARS,
  REASONING_MAX_PARTIAL_CHARS,
  REVEAL_CATCH_UP_TICKS,
  REVEAL_MIN_CHARS,
  StreamSmoother,
  TOOL_ELAPSED_AFTER_MS,
  TOOL_GUTTER,
  TOOL_TAIL_KEEP_CHARS,
  TOOL_TAIL_SHOW_CHARS,
  toolArgSummary,
  buildToolFoldRows,
  toolDoneLine,
  toolGroupLine,
  toolLabel,
  toolStartLine,
  type Palette,
} from '@nova-agent/tui-view';
import {
  estimateTextTokens,
  type AgentEvent,
  type SubagentProgress,
  type ToolCall,
  type UsageStats,
} from '@nova-agent/core';
import type { Config } from '../config.js';
import { createMarkdownRenderer, type MarkdownRenderer } from '../markdown.js';
import { reasoningLiveRow } from '@nova-agent/tui-view';
import { emptyCompletionNotice, llmRetryNotice, turnStopLines } from '../runner-loop.js';
import type { StopKind } from '@nova-agent/tui-view';
import type { Block, TuiStore } from './store.js';
import { SubagentLives } from './subagent-lives.js';

export interface TurnProjectorDeps {
  store: TuiStore;
  paint: Palette;
  /** 活调色板访问器（/theme 运行中重绑 paint；缺省回落构造时的 paint）。 */
  livePaint?: () => Palette;
  /** Terminal columns (budget math lives here so width contracts hold). */
  cols: () => number;
  now: () => number;
  /** Arm the shell's reveal interval — the projector never owns timers. */
  onNeedsReveal: () => void;
  /** User/answer gutter prefixes: the trailing open-style is a wrapBlock
   *  contract (text rows continue bold/dim), which Palette cannot express. */
  gutters: {
    user: { first: string; rest: string };
    assistant: { first: string; rest: string };
  };
}

export class TurnProjector {
  readonly subagentLives: SubagentLives;

  // ---- stream smoothing (codex-style typewriter) --------------------------
  // SSE deltas arrive in network bursts; both streams queue into smoothers
  // and the shell's steady tick meters them into the visible blocks, so text
  // flows instead of lurching. Buffers hold the ARRIVAL truth for semantics
  // (assistantText/reasoningBuffer); only the DISPLAY is paced.
  private readonly assistantStream = new StreamSmoother();
  private readonly reasoningStream = new StreamSmoother();
  /** Revealed reasoning text — the display mirror the live rows render. */
  private reasoningShown = '';

  private assistantText = '';
  private assistantOpen = false;
  private assistantBlock: Block | undefined;
  /** The blank separator block openAssistant pushes before each answer. */
  private assistantSeparator: Block | undefined;
  /** Incremental markdown renderer; re-created when a new answer opens. */
  private md: MarkdownRenderer | undefined;

  private reasoningBuffer = '';
  private reasoningOpen = false;

  /** The foreground subagent call whose progress rows map into live rows. */
  private liveFeedCallId: string | undefined;

  constructor(private readonly deps: TurnProjectorDeps) {
    const { store, paint } = deps;
    this.subagentLives = new SubagentLives({
      store,
      paint,
      budget: () => this.budget(),
      now: () => deps.now(),
    });
  }

  // ---- turn lifecycle ------------------------------------------------------

  /** Fresh turn: wipe per-turn fields, push the user row. Never touches
   *  blocks — pending removals are the caller's (or failure paths'). */
  beginTurn(userInput: string): void {
    this.resetTurnState();
    this.deps.store.pushBlock([userInput], this.deps.gutters.user, 'user');
  }

  /**
   * Failure display (run BEFORE endTurn): drop the unrevealed partial answer,
   * leave the marker line. Abort never shows a discarded-answer hint; a
   * non-abort error keeps a dim "已丢弃" line so the screen matches the log.
   */
  handleFailure(kind: 'abort' | 'error', errorMessage?: string): void {
    const { store, paint } = this.deps;
    if (this.assistantOpen) {
      // An aborted/errored turn may leave a partial assistant block that was
      // never closed (no 'message' event → never logged): drop it so the
      // screen matches the log. Committed text (assistantOpen false) is kept.
      if (this.assistantBlock !== undefined) store.removeBlock(this.assistantBlock);
      if (this.assistantSeparator !== undefined) store.removeBlock(this.assistantSeparator);
      this.assistantBlock = undefined;
      this.assistantSeparator = undefined;
      this.assistantOpen = false;
      this.assistantText = '';
      if (kind === 'error') {
        store.pushBlock([paint.dim('  ⟳ 未完成的回答已丢弃（未写入会话日志）')], TOOL_GUTTER);
      }
    }
    this.clearStreams();
    if (kind === 'abort') {
      store.pushBlock([paint.yellow('  ■ 已中断')]);
    } else {
      // API errors can be long: hang wrapped rows under the notice column.
      store.pushBlock([paint.red(`  ✗ 出错：${errorMessage ?? ''}`)], TOOL_GUTTER);
    }
  }

  /** Turn teardown (finally path, after handleFailure when failed): the
   *  shared reset — flags, live rows, transient blocks, pending text. */
  endTurn(): void {
    const { store } = this.deps;
    store.streaming = false;
    store.interruptAt = 0;
    store.genPhase = 'idle';
    // 中断/出错时活行等不到 tool_call_result 的改写：回退为静态行并清场，
    // 否则「⧉ 子代理 … tok」的假活行会永远停在转录里。
    this.subagentLives.abortAll();
    this.liveFeedCallId = undefined;
    // An abort/error never reaches the fold: no transient reasoning line may
    // survive into history.
    this.discardReasoning();
    this.reasoningOpen = false;
    this.reasoningBuffer = '';
    this.reasoningShown = '';
    this.clearStreams();
    store.closeReadGroup();
    this.assistantBlock = undefined;
    this.assistantSeparator = undefined;
    this.md = undefined;
    this.assistantOpen = false;
    this.assistantText = '';
  }

  // ---- streaming deltas (from runAgent events) -----------------------------

  appendAssistant(text: string): void {
    const { store, paint } = this.deps;
    store.tpsTokens += estimateTextTokens(text);
    if (!this.assistantOpen) {
      // Whitespace-only leading deltas (models often emit blank lines
      // before tool calls) must not anchor a blank answer block above
      // the tool lines — skip them until real content arrives.
      if (text.trim().length === 0) return;
      this.assistantOpen = true;
      this.assistantText = '';
      this.assistantBlock = undefined;
      store.genPhase = 'writing';
      this.reasoningOpen = false;
      store.closeReadGroup();
      // Codex cell contract: margins belong to each cell; flattenBlocks owns
      // the single blank row between non-empty store.blocks — the answer
      // opens with NO manual separator.
      this.foldToSummary();
      this.md = createMarkdownRenderer(paint);
      this.assistantSeparator = undefined;
      // The block opens empty; the reveal tick fills it (smoothing).
      this.assistantBlock = store.pushBlock([], this.deps.gutters.assistant, 'assistant');
    }
    this.assistantText += text;
    // Queue for the typewriter — arrival truth stays in assistantText.
    this.assistantStream.push(text);
    this.deps.onNeedsReveal();
  }

  appendReasoning(text: string): void {
    const { store } = this.deps;
    store.tpsTokens += estimateTextTokens(text);
    if (this.assistantOpen && this.assistantText.trim().length > 0) return;
    if (this.assistantOpen && this.assistantText.trim().length === 0) {
      this.assistantOpen = false;
    }
    store.genPhase = 'thinking';
    if (!this.reasoningOpen) {
      this.reasoningOpen = true;
      this.reasoningBuffer = '';
      this.reasoningShown = '';
      // Auto-expanded while store.streaming: the newest reasoning lines are
      // visible live (tail-capped); completion folds them away. Every row
      // sits at the text column (an unmarked first row at the marker column
      // just reads as a stray outdented line).
      store.pushBlock(['⋯'], { first: '    ', rest: '    ' }, 'reasoning');
      store.reasoningBlock = store.blocks[store.blocks.length - 1];
    }
    // The buffer is the truth (memory-only); the DISPLAY is fed through the
    // smoother — the live tail types out steadily instead of lurching.
    this.reasoningBuffer += text;
    if (this.reasoningBuffer.length > REASONING_FULL_MAX_CHARS) {
      this.reasoningBuffer = this.reasoningBuffer.slice(-REASONING_FULL_MAX_CHARS);
    }
    this.reasoningStream.push(text);
    this.deps.onNeedsReveal();
  }

  /** message event: nothing may stay unrevealed when the answer closes. */
  closeAssistant(): void {
    const { store } = this.deps;
    this.flushAssistant();
    if (this.assistantOpen && this.assistantText.trim().length === 0) {
      // A whitespace-only answer (blank lines before tool calls) leaves no
      // trace: drop the blank block and its separator BY IDENTITY — tool
      // blocks may sit after them by now.
      if (this.assistantBlock !== undefined) store.removeBlock(this.assistantBlock);
      if (this.assistantSeparator !== undefined) store.removeBlock(this.assistantSeparator);
    }
    this.assistantOpen = false;
  }

  /**
   * 思考段收尾（codex 风格）：思考只在流式期间滚动可见，一旦结束——答案
   * 开始、折叠调用、重试或中断——整块直接消失，转录里只留正式回答。
   * 思考正文从不落盘。
   */
  foldReasoning(): void {
    this.foldToSummary();
    this.reasoningBuffer = '';
    this.reasoningOpen = false;
  }

  /** Provider retry / empty-completion replay: the failed attempt leaves no trace. */
  resetAssistant(): void {
    const { store } = this.deps;
    // A provider retry replays the answer from scratch: the partial text and
    // its separator belong to the failed attempt — drop both.
    if (this.assistantBlock !== undefined) store.removeBlock(this.assistantBlock);
    if (this.assistantSeparator !== undefined) store.removeBlock(this.assistantSeparator);
    this.assistantBlock = undefined;
    this.assistantSeparator = undefined;
    this.assistantOpen = false;
    this.assistantText = '';
    // 重试的失败尝试不留任何痕迹（包括思考摘要行）。
    this.discardReasoning();
    this.reasoningOpen = false;
    this.reasoningBuffer = '';
    this.clearStreams();
  }

  // ---- reveal pacing (driven by the shell's tick) --------------------------

  /** One reveal step: drain a chunk of both streams into the visible blocks. */
  tick(): void {
    const { store } = this.deps;
    const answer = this.assistantStream.take(REVEAL_MIN_CHARS, REVEAL_CATCH_UP_TICKS);
    if (answer.length > 0 && this.assistantBlock !== undefined && this.md !== undefined) {
      store.replaceBlock(this.assistantBlock, this.md.push(answer));
    }
    const thought = this.reasoningStream.take(REVEAL_MIN_CHARS, REVEAL_CATCH_UP_TICKS);
    if (thought.length > 0) {
      this.reasoningShown = (this.reasoningShown + thought).slice(-REASONING_LIVE_KEEP_CHARS);
      this.renderReasoningLive();
    }
  }

  hasPendingReveal(): boolean {
    return this.assistantStream.length > 0 || this.reasoningStream.length > 0;
  }

  // ---- tool lines ----------------------------------------------------------

  toolStart(call: ToolCall): void {
    const { store, paint } = this.deps;
    // The reasoning phase ends when work begins; its transient tail is
    // removed and a later reasoning burst starts a fresh block.
    this.foldReasoning();
    store.genPhase = 'tool';
    // A new non-read call ends the current read-only group.
    if (!isReadOnlyTool(call.name)) store.closeReadGroup();
    if (call.name === 'subagent') this.liveFeedCallId = call.id;
    // Soft-wrapped continuation rows hang under the summary column.
    const block = store.pushBlock(
      [toolStartLine(paint, call.name, call.rawArgs, '•', this.budget())],
      TOOL_GUTTER,
    );
    store.toolBlocks.set(call.id, { block, startAt: this.deps.now(), name: call.name, rawArgs: call.rawArgs });
    store.activeToolId = call.id;
  }

  toolResult(call: ToolCall, content: string): void {
    const { store, paint } = this.deps;
    const entry = store.toolBlocks.get(call.id);
    if (store.activeToolId === call.id) store.activeToolId = undefined;
    if (call.name === 'subagent') this.liveFeedCallId = undefined;
    const duration = entry === undefined ? 0 : Math.max(0, this.deps.now() - entry.startAt);
    const failed = isFailureContent(content);
    if (isReadOnlyTool(call.name) && !failed) {
      // codex "Explored": the read's own line disappears and its summary
      // folds into the running group line.
      this.subagentLives.settle(call.id, [], duration);
      store.toolBlocks.delete(call.id);
      if (entry !== undefined) store.removeBlock(entry.block);
      // 宽预算存原文：公共目录折叠与最终排布都发生在 toolGroupLine 渲染时。
      const raw = toolArgSummary(call.name, call.rawArgs, 400);
      const summary = raw.length === 0 || raw === '{}' ? toolLabel(call.name) : raw;
      if (store.readGroup === undefined) {
        store.readGroup = {
          entries: [summary],
          startAt: entry === undefined ? this.deps.now() - duration : entry.startAt,
          block: store.pushBlock([], TOOL_GUTTER),
        };
      } else {
        store.readGroup.entries.push(summary);
      }
      store.replaceBlock(store.readGroup.block, [
        toolGroupLine(paint, store.readGroup.entries, this.deps.now() - store.readGroup.startAt, this.budget()),
      ]);
    } else {
      store.closeReadGroup();
      const lines = toolDoneLine(paint, call.name, call.rawArgs, content, duration, this.budget());
      // Dissolve any live state BEFORE the toolBlocks entry drops: on the
      // takeover path the block stays in place and carries the nested log as
      // collapsed click-expand; a fallback standalone block is removed.
      this.subagentLives.settle(call.id, lines, duration);
      store.toolBlocks.delete(call.id);
      if (entry !== undefined) {
        store.replaceBlock(entry.block, lines);
        // 三态折叠数据源随块常驻内存（resume 后不可展开，与 detail 同契约）；
        // 子代理接管块已挂 detail，点击归属它，不再叠 fold。
        if (entry.block.detail === undefined) {
          const fold = buildToolFoldRows(paint, lines, content, this.budget());
          if (fold !== undefined) entry.block.fold = { ...fold, state: 0 };
        }
      } else store.pushBlock(lines);
    }
  }

  /** Live bash output lands in the running tool block's tail buffer. */
  toolTail(text: string): void {
    const { store } = this.deps;
    const entry = store.activeToolId !== undefined ? store.toolBlocks.get(store.activeToolId) : undefined;
    if (entry === undefined) return;
    // Code-point slice (TuiStore.appendTail): a UTF-16 slice can split a
    // surrogate pair.
    store.appendTail(entry, text, TOOL_TAIL_KEEP_CHARS, TOOL_TAIL_SHOW_CHARS);
  }

  /**
   * Spinner tick body: animate the bullet of every running tool block
   * (codex-style activity marker). After two seconds a live elapsed suffix
   * appears so a slow command never looks frozen; an interrupt gets a
   * "正在中断" suffix. Taken-over entries are skipped — a subagent live row
   * IS the current face of that block (去重契约).
   */
  animateRunningTools(frame: string): void {
    const { store, paint } = this.deps;
    const now = this.deps.now();
    const budget = this.budget();
    for (const [callId, entry] of store.toolBlocks) {
      if (this.subagentLives.has(callId)) continue;
      const elapsed = now - entry.startAt;
      const suffix = store.interruptAt > 0
        ? paint.yellow(' · 正在中断…')
        : elapsed >= TOOL_ELAPSED_AFTER_MS
          ? paint.dim(` · ${Math.floor(elapsed / 1000)}s`)
          : '';
      // 预算扣掉 suffix 的位（` · Ns` / ` · 正在中断…`），整行含后缀恒单行。
      const lines = [toolStartLine(paint, entry.name, entry.rawArgs, frame, budget - styledWidth(suffix)) + suffix];
      // Live output tail for streaming tools (bash): the last line of
      // whatever the process has printed so far. Code-point slice keeps
      // surrogate pairs intact.
      const tailBuf = entry.tailBuf;
      if (tailBuf !== undefined) {
        const last = [...tailBuf].slice(-TOOL_TAIL_SHOW_CHARS).join('').split('\n').pop()?.trimEnd() ?? '';
        if (last.length > 0) {
          lines.push(`      ${paint.dim(`└ ${fitTail(last, Math.max(10, budget - 9))}`)}`);
        }
      }
      // Dirty-check: identical rows skip the replace (no wrap-cache churn).
      if (entry.block.lines.join('\n') !== lines.join('\n')) store.replaceBlock(entry.block, lines);
    }
    // Live subagent rows cycle their glyph with the same tick — a child
    // thinking between bursts never looks stalled (render is dirty-checked).
    this.subagentLives.renderAll(frame);
  }

  // ---- subagent progress feed ---------------------------------------------

  /** Route one nested progress event to the pinned foreground call. */
  subagentProgress(progress: SubagentProgress): void {
    if (this.liveFeedCallId === undefined) return;
    this.subagentLives.progress(this.liveFeedCallId, progress);
  }

  // ---- agent event reduction ------------------------------------------------

  /**
   * 轮事件的呈现归约（阶段 E 出壳自壳层的 agentTurn 事件 switch）：只做投影与
   * 呈现行。壳层态（日志追加/usage 合并/锚点、spinner、会话缓存累计、重绘）
   * 按事件类型另补几笔——见壳层 onAgentEvent。
   */
  onEvent(event: AgentEvent, ctx: { stats: UsageStats; elapsedMs: number; config: Config }): void {
    const store = this.deps.store;
    switch (event.type) {
      case 'llm_retry': {
        // The provider dropped the response mid-stream and is re-requesting:
        // discard the partial answer and leave a dim audit line. The failed
        // attempt's usage (merged in the shell) stays a valid anchor — the
        // retry sends the same prompt prefix.
        this.resetAssistant();
        store.genPhase = 'thinking'; // 重新请求在途，属于"生成中"
        store.pushBlock([this.livePaint().dim(`  ⟳ ${llmRetryNotice(event.error, event.attempt, event.maxRetries)}`)], TOOL_GUTTER);
        return;
      }
      case 'empty_completion': {
        // The model "finished" with no text and no tool calls — everything
        // went into the thinking stream. The loop re-issues; this line
        // explains why the thinking appears to restart.
        this.resetAssistant();
        store.genPhase = 'thinking';
        store.pushBlock(
          [this.livePaint().dim(`  ⟳ ${emptyCompletionNotice(event.finishReason, event.attempt, event.maxRetries)}`)],
          TOOL_GUTTER,
        );
        return;
      }
      case 'text_delta':
        // Empty deltas do nothing: the assistant opens lazily on the first
        // non-blank delta, so reasoning phase is never reset by padding.
        if (event.text.length === 0) return;
        this.appendAssistant(event.text);
        return;
      case 'reasoning_delta':
        this.appendReasoning(event.text);
        return;
      case 'message':
        this.closeAssistant();
        return;
      case 'tool_call_start':
        // 折叠思考尾行、genPhase、只读分组收尾、前台子代理的进度路由、待定行
        // 块与 toolBlocks 登记——投影全部在 toolStart 里。
        this.toolStart(event.call);
        return;
      case 'tool_call_result':
        // 完成行/只读分组归并/子代理活行收编——投影在 toolResult。
        this.toolResult(event.call, event.result.content);
        return;
      case 'done': {
        store.closeReadGroup();
        this.foldReasoning();
        // A normal completion ends at the reply — no per-turn stats line (the
        // status bar carries tokens; /session carries details). Only abnormal
        // stops get a visible marker.
        if (event.stopReason !== 'complete') {
          const kind: StopKind = event.stopReason;
          store.pushBlock(turnStopLines(this.livePaint(), kind, ctx.stats, ctx.elapsedMs, ctx.config));
        }
        return;
      }
      default:
        // turn_start / usage / turn_aborted: 无投影动作（簿记在壳层）。
        return;
    }
  }

  /** 活调色板：/theme 运行中重绑 paint，呈现行必须用当前值。 */
  private livePaint(): Palette {
    return this.deps.livePaint?.() ?? this.deps.paint;
  }

  // ---- internals ------------------------------------------------------------

  private resetTurnState(): void {
    this.clearStreams();
    this.reasoningBuffer = '';
    this.reasoningOpen = false;
    this.assistantText = '';
    this.assistantOpen = false;
    this.assistantBlock = undefined;
    this.assistantSeparator = undefined;
    this.md = undefined;
    this.liveFeedCallId = undefined;
  }

  private clearStreams(): void {
    this.assistantStream.clear();
    this.reasoningStream.clear();
    this.reasoningShown = '';
  }

  /** Reveal whatever answer text is still pending (close/turn-end paths). */
  private flushAssistant(): void {
    const { store } = this.deps;
    const chunk = this.assistantStream.flush();
    if (chunk.length > 0 && this.assistantBlock !== undefined && this.md !== undefined) {
      store.replaceBlock(this.assistantBlock, this.md.push(chunk));
    }
  }

  /** 思考收尾：整块消失（答案开始/折叠/重试/中断共用），不留摘要行。 */
  private foldToSummary(): void {
    this.reasoningBuffer = '';
    this.reasoningStream.clear();
    this.reasoningShown = '';
    this.discardReasoning();
  }

  /** Remove the live reasoning block: the answer, not the thinking, is what
   *  the user came for — only the streaming tail is shown. */
  private discardReasoning(): void {
    const { store } = this.deps;
    if (store.reasoningBlock === undefined) return;
    store.removeBlock(store.reasoningBlock);
    store.reasoningBlock = undefined;
  }

  /** Recompute the live reasoning rows from the revealed buffer (dirty-checked). */
  private renderReasoningLive(): void {
    const { store, paint } = this.deps;
    const block = store.reasoningBlock;
    if (block === undefined) return;
    const parts = this.reasoningShown.split('\n');
    const livePartial = (parts.pop() ?? '').replace(/\s+$/u, '').slice(-REASONING_MAX_PARTIAL_CHARS);
    const done = parts.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
    const lines = reasoningLiveRow(paint, {
      done,
      partial: livePartial,
      cols: this.deps.cols(),
    });
    if (block.lines.join('\n') !== lines.join('\n')) store.replaceBlock(block, lines);
  }

  private budget(): number {
    return this.deps.store.budget(this.deps.cols());
  }
}
