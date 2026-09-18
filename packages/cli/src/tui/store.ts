/**
 * Transcript store: blocks, tool groups, reasoning window, input, pickers,
 * approval state, tps meter, generation phase. All shell-mutable TUI state
 * lives here behind explicit methods; rendering stays in tui-view.
 */

import type { ToolCall } from '@nova-agent/core';
import { alwaysScopeWords, type AskResult, type PermissionKind } from '@nova-agent/plugins';
import type { SessionEntry } from '../sessions.js';
import {
  APPROVAL_OPTIONS,
  REASONING_FULL_MAX_LINES,
  REASONING_MAX_LINES,
  REASONING_MAX_PARTIAL_CHARS,
  SPINNER_TICKS_PER_FRAME,
  TOOL_GUTTER,
  TPS_INTERVAL_MS,
  TPS_SAMPLES,
  toolBudget,
  type ComposerChip,
  type Palette,
  type ToolFoldRows,
} from '@nova-agent/tui-view';

export interface Block {
  lines: string[];
  wrapped: string[] | undefined;
  gutter?: { first: string; rest: string };
  /** Click-expand body (subagent nested log): rows shown under `base`. */
  detail?: { lines: string[]; secs: number; base?: string[] };
  expanded?: boolean;
  /** 工具输出三态折叠（Grok 组件3）：0=Collapsed 头行 / 1=Truncated 预览 / 2=Expanded 全文。 */
  fold?: ToolFoldRows & { state: 0 | 1 | 2 };
  kind?: 'user' | 'reasoning' | 'assistant' | 'tool' | 'system';
}

export interface ToolEntry {
  block: Block;
  startAt: number;
  name: string;
  rawArgs: string;
  tailBuf?: string;
  /** Read-only call claimed by the live verb group: no own line, animates not. */
  groupMember?: ReadGroupMember;
}

export interface ReadGroupMember {
  name: string;
  summary: string;
  failed: boolean;
  /** No result yet: keeps the group line in present aspect. */
  pending: boolean;
}

export interface ReadGroup {
  members: ReadGroupMember[];
  startAt: number;
  block: Block;
}

export type GenPhase = 'idle' | 'thinking' | 'writing' | 'tool';

export interface ApprovalState {
  call: ToolCall;
  kind: PermissionKind;
  resolve: (a: AskResult) => void;
}

export const APPROVAL_CODES = APPROVAL_OPTIONS.map((o) => o.code);

export class TuiStore {
  readonly blocks: Block[] = [];
  readonly historyStack: string[] = [];
  /** Mid-turn enqueued user messages; drained FIFO after the running turn ends. */
  readonly messageQueue: string[] = [];
  readonly toolBlocks = new Map<string, ToolEntry>();
  readonly tpsRing: number[] = Array<number>(TPS_SAMPLES).fill(0);

  blocksVersion = 0;
  scrollFromEnd = 0;
  input = '';
  cursorPos = 0;
  /** 组件8：composer 粘贴 chip（UTF-16 区间，纯显示折叠，缓冲区原文不动）。 */
  inputChips: ComposerChip[] = [];
  popupIndex = 0;
  popupDismissed = false;
  historyIdx = -1;
  historyDraft = '';
  modelPicker: { models: string[]; index: number } | undefined;
  sessionPicker: { entries: SessionEntry[]; index: number } | undefined;
  /** Startup mode selector: active at launch, collapsed on confirm/Esc/first submit. */
  modeSelect: { index: number } | undefined;
  /**
   * 开屏卡片垂直居中：首轮提交前把视口空白挪到内容上方（消掉整屏空洞），
   * 第一条消息落地即关闭——之后是文档流，不再挪。
   */
  welcomeCenter = false;
  approval: ApprovalState | undefined;
  approvalIndex = 0;
  /** 组件6：always 行的授权词数（当前命令前 N 词），每次弹窗重置为 1。 */
  approvalScope = 1;
  /** 组件7：拒绝行上打出的字——随 deny 授权回流给模型作追问/指令。 */
  approvalNote = '';
  approvalPreview: string[] | undefined;
  /**
   * 全局动效时钟：壳层唯一的 `TICK_MS` 定时器递增它，转轮帧、导轨行波、以及
   * 以后所有"活"的元素都从这一个计数器取相位（Grok 就是一个 tick 驱动全部动效）。
   */
  tick = 0;
  /** 转轮帧 = tick / 4（≈132ms/帧）。派生量，别再去赋值它。 */
  get spinnerFrame(): number {
    return Math.floor(this.tick / SPINNER_TICKS_PER_FRAME);
  }
  interruptAt = 0;
  lastCtrlC = 0;
  streaming = false;
  compactRunning = false;
  modeSwitching = false;
  activeToolId: string | undefined;
  readGroup: ReadGroup | undefined;
  reasoningBlock: Block | undefined;
  tpsTokens = 0;
  tpsLastTokens = 0;
  tpsLastAt = 0;
  /** Real samples pushed into tpsRing; 0 = nothing streamed yet this session. */
  tpsSamples = 0;
  genPhase: GenPhase = 'idle';
  frameMap:
    | {
        rows: { block: Block; start: number; count: number }[];
        sliceStart: number;
        historyRows: number;
        /** 开屏居中时顶部的空白行数：点击行号要先减它才落到内容坐标。 */
        topPad: number;
      }
    | undefined;
  /** Meter hover (M10 组件1): mousemove over `statusZone` morphs the T2 gauge. */
  gaugeHover = false;
  /** Last rendered status-row hit zone: y (1-based SGR row), gaugeEnd (display cols). */
  statusZone: { y: number; gaugeEnd: number } | undefined;

  /** Render trigger — invoked by every mutation method so the view refreshes. */
  readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  pushBlock(lines: string[], gutter?: Block['gutter'], kind?: Block['kind']): Block {
    const block: Block = {
      lines,
      wrapped: undefined,
      ...(gutter !== undefined ? { gutter } : {}),
      ...(kind !== undefined ? { kind } : {}),
    };
    this.blocks.push(block);
    this.blocksVersion += 1;
    this.onChange();
    return block;
  }

  replaceBlock(block: Block, lines: string[]): void {
    if (!this.blocks.includes(block)) {
      this.blocks.push({ lines, wrapped: undefined, ...(block.gutter !== undefined ? { gutter: block.gutter } : {}) });
    } else {
      block.lines = lines;
      block.wrapped = undefined;
    }
    this.blocksVersion += 1;
    this.onChange();
  }

  removeBlock(block: Block): void {
    const idx = this.blocks.indexOf(block);
    if (idx >= 0) this.blocks.splice(idx, 1);
    this.blocksVersion += 1;
    this.onChange();
  }

  closeReadGroup(): void {
    this.readGroup = undefined;
  }

  /**
   * 组件6：当前审批可调节的 always 授权词表——execute 且命令是裸式才有词，
   * 复合/无 command 返回 []（不可调，维持默认记忆粒度）。
   */
  approvalScopeWords(): string[] {
    const ap = this.approval;
    if (ap === undefined || ap.kind !== 'execute') return [];
    return alwaysScopeWords(ap.call.args['command']);
  }

  /** Queue a message typed while a turn is streaming (rendered above the composer). */
  enqueueMessage(text: string): void {
    this.messageQueue.push(text);
    this.onChange();
  }

  dequeueMessage(): string | undefined {
    const next = this.messageQueue.shift();
    if (next !== undefined) this.onChange();
    return next;
  }

  clearView(): void {
    this.blocks.length = 0;
    this.toolBlocks.clear();
    this.closeReadGroup();
    this.reasoningBlock = undefined;
    this.scrollFromEnd = 0;
    this.blocksVersion += 1;
    this.onChange();
  }

  /**
   * 组件8：文本突变的唯一原语——就地 splice 并重记账 chip 区间：
   * 编辑区之前不动、之后整体平移、与编辑区相交的 chip 溶解（其文字随编辑消失）。
   * 光标恒在 chip 边界（按键链保证），故相交只可能来自整吞或展开后的编辑。
   */
  spliceInput(at: number, deleteCount: number, insert = ''): void {
    this.input = this.input.slice(0, at) + insert + this.input.slice(at + deleteCount);
    const end = at + deleteCount;
    const delta = insert.length - deleteCount;
    this.inputChips = this.inputChips.flatMap((c) =>
      c.end <= at ? [c] : c.start >= end ? [{ start: c.start + delta, end: c.end + delta }] : [],
    );
    this.onChange();
  }

  /** 整体替换输入（提交清空/历史召回/弹窗改名）：chip 与旧缓冲一同作废。 */
  setInputAll(text: string, cursor = text.length): void {
    this.input = text;
    this.cursorPos = Math.max(0, Math.min(cursor, text.length));
    this.inputChips = [];
    this.onChange();
  }

  /** 光标压在 chip 边界（side 侧）时展开该 chip：还原可见文字，chip 消失。 */
  expandChipAt(pos: number, side: 'start' | 'end'): boolean {
    const i = this.inputChips.findIndex((c) => (side === 'end' ? c.end : c.start) === pos);
    if (i < 0) return false;
    this.inputChips.splice(i, 1);
    this.onChange();
    return true;
  }

  budget(cols: number): number {
    return toolBudget(cols);
  }

  gutter(): { first: string; rest: string } {
    return TOOL_GUTTER;
  }

  /** tps sample gate: only real output advances the window, else freeze it. */
  sampleTps(now: number): void {
    if (now - this.tpsLastAt >= TPS_INTERVAL_MS) {
      const secs = (now - this.tpsLastAt) / 1000;
      if (this.tpsTokens > this.tpsLastTokens) {
        this.tpsRing.push(Math.round((this.tpsTokens - this.tpsLastTokens) / secs));
        if (this.tpsRing.length > TPS_SAMPLES) this.tpsRing.shift();
        this.tpsSamples += 1;
      }
      this.tpsLastTokens = this.tpsTokens;
      this.tpsLastAt = now;
    }
  }

  /** Code-point-safe tail append for live tool output. */
  appendTail(entry: ToolEntry, text: string, keepChars: number, showChars: number): string | undefined {
    const merged = (entry.tailBuf ?? '') + text;
    entry.tailBuf = [...merged].slice(-keepChars).join('');
    void showChars;
    const last = entry.tailBuf.slice(entry.tailBuf.lastIndexOf('\n') + 1).trimEnd();
    return last.length > 0 ? last : undefined;
  }
}

export { REASONING_FULL_MAX_LINES, REASONING_MAX_LINES, REASONING_MAX_PARTIAL_CHARS };
export type { Palette };
