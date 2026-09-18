/**
 * Subagent live rows. Foreground children TAKE OVER their pending tool line —
 * one block morphs 调用 → ◈ live → 完成行, so the same fact is never drawn
 * twice (the line animation skips taken-over entries). Background (detached)
 * children have no pending line to adopt, so they pin their own row and
 * self-refresh until the job settles. The nested execution log accumulates in
 * memory and rides on the block as `detail` (click-expand; never persisted —
 * same contract as reasoning, gone after resume).
 */

import type { JobSnapshot, SubagentProgress } from '@nova-agent/core';
import {
  bgSubagentDoneLine,
  bgSubagentLine,
  subagentDetailRows,
  subagentLiveLine,
  TOOL_GUTTER,
  toolArgSummary,
  toolStartLine,
  type Palette,
} from '@nova-agent/tui-view';
import type { Block, TuiStore } from './store.js';

interface LiveState {
  label: string;
  lastTool?: string;
  toolCounts: Map<string, number>;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  /** Nested execution log (tool lines + milestones): the click-expand body. */
  detail: string[];
  startAt: number;
  block: Block;
}

/** Nested-log cap: oldest entries fall off (memory-only detail). */
const DETAIL_MAX = 200;

export interface SubagentLivesDeps {
  store: TuiStore;
  paint: Palette;
  /** Current tool-line width budget (terminal-cols dependent). */
  budget: () => number;
  now: () => number;
}

export class SubagentLives {
  private readonly lives = new Map<string, LiveState>();

  constructor(private readonly deps: SubagentLivesDeps) {}

  /** Taken-over call ids must be skipped by the pending-line animation. */
  has(callId: string): boolean {
    return this.lives.has(callId);
  }

  /** Feed one nested progress event (keyed by the parent tool CALL id). */
  progress(callId: string, p: SubagentProgress): void {
    if (p.type === 'start') {
      const { store } = this.deps;
      const entry = store.toolBlocks.get(callId);
      const block = entry !== undefined ? entry.block : store.pushBlock([], TOOL_GUTTER, 'tool');
      this.lives.set(callId, {
        label: p.label,
        toolCounts: new Map(),
        turns: 0,
        promptTokens: 0,
        completionTokens: 0,
        detail: [`▸ ${p.label}`],
        startAt: this.deps.now(),
        block,
      });
      this.render(callId);
    } else if (p.type === 'tool_call') {
      const st = this.lives.get(callId);
      if (st === undefined) return;
      st.lastTool = p.call.name;
      st.toolCounts.set(p.call.name, (st.toolCounts.get(p.call.name) ?? 0) + 1);
      this.pushDetail(st, `› ${p.call.name} ${toolArgSummary(p.call.name, p.call.rawArgs, 80)}`);
      this.render(callId);
    } else if (p.type === 'usage') {
      const st = this.lives.get(callId);
      if (st === undefined) return;
      st.turns = p.stats.turns;
      st.promptTokens = p.stats.promptTokens;
      st.completionTokens = p.stats.completionTokens;
      this.render(callId);
    } else {
      // `done`: the live row stays live until settle() morphs it into the
      // parent tool's own done row (same frame the result is appended).
      const st = this.lives.get(callId);
      if (st === undefined) return;
      st.turns = p.usage.turns;
      st.promptTokens = p.usage.promptTokens;
      st.completionTokens = p.usage.completionTokens;
      this.pushDetail(
        st,
        p.status === 'completed'
          ? `✓ 完成 · ${p.usage.turns} 轮 · ${p.usage.toolCalls} 次工具 · ${(p.usage.elapsedMs / 1000).toFixed(1)}s`
          : p.status === 'aborted'
            ? '■ 已中止'
            : '■ 结束（无最终报告）',
      );
      this.render(callId);
    }
  }

  /** Spinner tick: cycle the glyph of every live row (render is dirty-checked). */
  renderAll(frame = '•'): void {
    for (const callId of this.lives.keys()) this.render(callId, frame);
  }

  /**
   * The parent's tool_call_result arrived: dissolve the live state. On the
   * takeover path the block stays in place — the caller's done-line rewrite
   * carries the nested log as collapsed click-expand (`detail.base` is the
   * done line). A fallback standalone block is removed instead. Pass empty
   * `doneLines` when the result folds elsewhere (read-only group).
   */
  settle(callId: string, doneLines: string[], durationMs: number): void {
    const st = this.lives.get(callId);
    if (st === undefined) return;
    this.lives.delete(callId);
    const { store } = this.deps;
    const entry = store.toolBlocks.get(callId);
    if (entry !== undefined && entry.block === st.block && doneLines.length > 0) {
      // 完成行默认收起，但嵌套日志仍随 block 可点击展开（内存态，
      // resume 后不可展开——与 reasoning 详情同一契约）。
      st.block.detail = { lines: this.detailRows(st), secs: Math.floor(durationMs / 1000), base: doneLines };
      st.block.expanded = false;
      return;
    }
    if (store.blocks.includes(st.block)) store.removeBlock(st.block);
  }

  /** Abort/error: the row never gets its result rewrite — fall back to ■. */
  abortAll(): void {
    const { store, paint, budget, now } = this.deps;
    for (const [callId, st] of this.lives) {
      const entry = store.toolBlocks.get(callId);
      if (entry !== undefined && entry.block === st.block) {
        const base = [toolStartLine(paint, entry.name, entry.rawArgs, '■', budget())];
        // 已积累的嵌套日志保留可展开（中止了也看得到它做到了哪一步）。
        st.block.detail = {
          lines: this.detailRows(st),
          secs: Math.floor((now() - st.startAt) / 1000),
          base,
        };
        st.block.expanded = false;
        store.replaceBlock(st.block, base);
      } else if (store.blocks.includes(st.block)) {
        store.removeBlock(st.block);
      }
    }
    this.lives.clear();
  }

  private detailRows(st: LiveState): string[] {
    return subagentDetailRows(this.deps.paint, st.detail, this.deps.budget());
  }

  private pushDetail(st: LiveState, line: string): void {
    st.detail.push(line);
    while (st.detail.length > DETAIL_MAX) st.detail.shift();
  }

  private render(callId: string, frame = '•'): void {
    const st = this.lives.get(callId);
    if (st === undefined) return;
    const { store, paint } = this.deps;
    const head = subagentLiveLine(
      paint,
      {
        label: st.label,
        ...(st.lastTool !== undefined ? { lastTool: st.lastTool } : {}),
        toolCounts: st.toolCounts,
        turns: st.turns,
        promptTokens: st.promptTokens,
        completionTokens: st.completionTokens,
        expandable: st.detail.length > 0,
        expanded: st.block.expanded === true,
      },
      frame,
    );
    // Click-expand body rides on the block: the click chain (keys.ts) reads
    // block.detail/expanded, live re-renders must keep them in sync.
    const rows = this.detailRows(st);
    st.block.detail = { lines: rows, secs: Math.floor((this.deps.now() - st.startAt) / 1000), base: [head] };
    store.replaceBlock(st.block, st.block.expanded === true ? [head, ...rows] : [head]);
  }
}

export interface BgSubagentRowsDeps {
  store: TuiStore;
  paint: Palette;
  /** Read side of the job registry (snapshots are peek semantics). */
  jobs: { list(): JobSnapshot[]; get(id: string): JobSnapshot | undefined };
  now: () => number;
  /** Refresh cadence while rows run on their own (parent turn may be over). */
  intervalMs?: number;
}

/**
 * Live rows for `run_in_background` delegations: without them the start line
 * reads "✓ 调用 subagent … · 0.0s" and nothing moves until the model polls
 * `jobs`. Each running job pins one row (elapsed + latest nested activity);
 * settlement rewrites it in place — never a second line.
 */
export class BgSubagentRows {
  private readonly rows = new Map<string, { block: Block; short: string }>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: BgSubagentRowsDeps) {}

  /** Poll job snapshots: pin new rows, rewrite settled ones in place. */
  sync(): void {
    const { store, paint, jobs, now } = this.deps;
    const active = jobs
      .list()
      .filter((job) => job.kind === 'subagent' && (job.status === 'running' || job.status === 'stopping'));
    for (const [id, entry] of this.rows) {
      const job = jobs.get(id);
      if (job === undefined) {
        this.rows.delete(id);
        continue;
      }
      if (job.status !== 'running' && job.status !== 'stopping') {
        // In-place rewrite (never a second line): start row becomes the
        // terminal row with status + usage trailer.
        const line = bgSubagentDoneLine(paint, { label: entry.short, status: job.status, detail: job.detail });
        if (store.blocks.includes(entry.block)) store.replaceBlock(entry.block, [line]);
        this.rows.delete(id);
      }
    }
    for (const job of active) {
      const short = shortLabel(job.label);
      const elapsed = Math.max(0, Math.round((now() - (job.startedAt ?? now())) / 1000));
      const line = bgSubagentLine(paint, { label: short, elapsedSecs: elapsed, progress: job.progress });
      const existing = this.rows.get(job.id);
      if (existing === undefined) {
        this.rows.set(job.id, { block: store.pushBlock([line]), short });
      } else if (existing.block.lines[0] !== line) {
        store.replaceBlock(existing.block, [line]);
      }
    }
    // A detached subagent outlives the parent turn (spinner stopped), so the
    // refresh cadence is self-managed: tick while any row runs, stop after.
    if (active.length > 0 && this.timer === undefined) {
      this.timer = setInterval(() => this.sync(), this.deps.intervalMs ?? 1000);
    } else if (active.length === 0 && this.timer !== undefined) {
      this.stop();
    }
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** View reset (/clear, session switch): the blocks are gone, drop the map. */
  clear(): void {
    this.rows.clear();
    this.stop();
  }
}

const shortLabel = (label: string): string => {
  const base = /^\[subagent: ([^\]]+)\]/.exec(label)?.[1] ?? label;
  return base.length > 40 ? `${base.slice(0, 39)}…` : base;
};
