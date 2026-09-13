/**
 * Transcript store: blocks, tool groups, reasoning window, input, pickers,
 * approval state, tps meter, generation phase. All shell-mutable TUI state
 * lives here behind explicit methods; rendering stays in tui-view.
 */

import type { ToolCall } from '@nova-agent/core';
import type { PermissionKind } from '@nova-agent/plugins';
import type { SessionEntry } from '../sessions.js';
import {
  APPROVAL_OPTIONS,
  REASONING_FULL_MAX_LINES,
  REASONING_MAX_LINES,
  REASONING_MAX_PARTIAL_CHARS,
  TOOL_GUTTER,
  TPS_INTERVAL_MS,
  TPS_SAMPLES,
  toolBudget,
  type Palette,
} from '@nova-agent/tui-view';

export interface Block {
  lines: string[];
  wrapped: string[] | undefined;
  gutter?: { first: string; rest: string };
  detail?: { lines: string[]; secs: number };
  expanded?: boolean;
  kind?: 'user' | 'reasoning' | 'assistant' | 'tool' | 'system';
}

export interface ToolEntry {
  block: Block;
  startAt: number;
  name: string;
  rawArgs: string;
  tailBuf?: string;
}

export interface ReadGroup {
  entries: string[];
  startAt: number;
  block: Block;
}

export type GenPhase = 'idle' | 'thinking' | 'writing' | 'tool';

export interface ApprovalState {
  call: ToolCall;
  kind: PermissionKind;
  resolve: (a: 'allow' | 'deny' | 'always') => void;
}

export const APPROVAL_CODES = APPROVAL_OPTIONS.map((o) => o.code);

export class TuiStore {
  readonly blocks: Block[] = [];
  readonly historyStack: string[] = [];
  readonly toolBlocks = new Map<string, ToolEntry>();
  readonly tpsRing: number[] = Array<number>(TPS_SAMPLES).fill(0);

  blocksVersion = 0;
  scrollFromEnd = 0;
  input = '';
  cursorPos = 0;
  popupIndex = 0;
  popupDismissed = false;
  historyIdx = -1;
  historyDraft = '';
  modelPicker: { models: string[]; index: number } | undefined;
  sessionPicker: { entries: SessionEntry[]; index: number } | undefined;
  approval: ApprovalState | undefined;
  approvalIndex = 0;
  approvalPreview: string[] | undefined;
  spinnerFrame = 0;
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
    | { rows: { block: Block; start: number; count: number }[]; sliceStart: number; historyRows: number }
    | undefined;

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

  clearView(): void {
    this.blocks.length = 0;
    this.toolBlocks.clear();
    this.closeReadGroup();
    this.reasoningBlock = undefined;
    this.scrollFromEnd = 0;
    this.blocksVersion += 1;
    this.onChange();
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
