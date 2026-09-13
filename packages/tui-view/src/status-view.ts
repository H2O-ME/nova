/**
 * Single-line status bar + context breakdown. Pure computation: the shell
 * assembles a StatusView snapshot per frame; colors inject via Palette.
 */

import {
  estimateMessageTokens,
  estimateNextPromptTokens,
  estimateTextTokens,
  type AgentMessage,
  type ToolDefinition,
  type Usage,
} from '@nova-agent/core';
import { styledWidth } from '@nova-agent/tui';
import type { PtcMode } from '@nova-agent/core';
import { approvalLabel } from './labels.js';
import type { Palette } from './palette.js';
import { humanTokens } from './tool-lines.js';
import { clipToWidth } from './clip.js';

/** Execution-mode chip label shared by the status bar, /mode and /session. */
export function codeModeLabel(m: PtcMode): string {
  return m === 'native' ? '普通' : m === 'ptc' ? 'PTC' : '混合';
}

export interface ContextBreakdownView {
  systemPrompt: string;
  tools: readonly Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[];
  messages: readonly AgentMessage[];
  usageAnchor: Usage | undefined;
  anchorMsgCount: number;
  contextWindow: number | undefined;
  modelMetaContextWindow: number | undefined;
}

/** One structural segment (prompt/tools/injected/skills/messages). */
export interface ContextSegment {
  label: string;
  tokens: number;
  color: 'cyan' | 'green' | 'yellow' | 'blue' | 'magenta';
}

/**
 * Context breakdown shared by the gauge and /session details. With a usage
 * anchor the total is real prompt tokens (anchor + delta); segments scale by
 * one calibration factor so they always sum to `used`.
 */
export function contextBreakdown(view: ContextBreakdownView): {
  segments: ContextSegment[];
  used: number;
  capacity: number | undefined;
} {
  const sys = estimateTextTokens(view.systemPrompt);
  let toolSchemas = 0;
  for (const t of view.tools) {
    toolSchemas += estimateTextTokens(`${t.name} ${t.description ?? ''} ${JSON.stringify(t.parameters ?? {})}`);
  }
  let injected = 0;
  let skillsTok = 0;
  let history = 0;
  const SKILL_OPEN = '<available_skills>';
  const SKILL_CLOSE = '</available_skills>';
  for (const m of view.messages) {
    const tokens = estimateMessageTokens(m);
    if (m.role === 'user' && m.content.trimStart().startsWith('<')) {
      injected += tokens;
      const s = m.content.indexOf(SKILL_OPEN);
      const e = m.content.indexOf(SKILL_CLOSE);
      if (s >= 0 && e > s) skillsTok += estimateTextTokens(m.content.slice(s, e + SKILL_CLOSE.length));
    } else history += tokens;
  }
  const estimate = sys + toolSchemas + injected + history;
  const used =
    view.usageAnchor !== undefined
      ? estimateNextPromptTokens(view.usageAnchor, view.messages.slice(view.anchorMsgCount))
      : estimate;
  const factor = estimate > 0 && used > 0 ? used / estimate : 1;
  const scale = (n: number): number => Math.round(n * factor);
  const segments: ContextSegment[] = [
    { label: '提示词', tokens: scale(sys), color: 'cyan' },
    { label: '工具', tokens: scale(toolSchemas), color: 'green' },
    { label: '注入', tokens: scale(Math.max(0, injected - skillsTok)), color: 'blue' },
    { label: '技能', tokens: scale(skillsTok), color: 'magenta' },
    { label: '消息', tokens: scale(history), color: 'yellow' },
  ];
  if (factor !== 1) {
    const drift = used - segments.reduce((sum, s) => sum + s.tokens, 0);
    segments[0]!.tokens = Math.max(0, segments[0]!.tokens + drift);
  }
  return { segments, used, capacity: view.contextWindow ?? view.modelMetaContextWindow };
}

/** Cache key for the three-tier gauge memo (computed in the shell). */
export function gaugeCacheKey(v: {
  messagesLen: number;
  usageAnchor: Usage | undefined;
  model: string;
  codeMode: PtcMode;
  modelMetaVersion: number;
  capacity: number | undefined;
  toolCount: number;
  compactLimit: number | undefined;
  cols: number;
}): string {
  return (
    `${v.messagesLen}|${v.usageAnchor?.promptTokens ?? -1}|${v.model}|` +
    `${v.codeMode}|${v.modelMetaVersion}|${v.capacity ?? 0}|${v.toolCount}|` +
    `${v.compactLimit ?? 0}|${v.cols}`
  );
}

/**
 * Deal `cells` slots by largest-remainder: totals always equal cells,
 * non-positive weights take none, zero-weight segments take none.
 */
export function allocateCells(weights: number[], cells: number): number[] {
  if (cells <= 0) return weights.map(() => 0);
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const total = clean.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return clean.map(() => 0);
  const exact = clean.map((w) => (w / total) * cells);
  const base = exact.map((v) => Math.floor(v));
  let left = cells - base.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((v, i) => ({ rem: v - Math.floor(v), i }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    left -= 1;
  }
  return base;
}

/**
 * Segments → cell plan. Strictly proportional to the whole window (free
 * capacity joins the same largest-remainder round): no "nonzero takes ≥1"
 * borrowing, so a 1.2k slice of a 1M window honestly paints ~0 cells.
 */
export function planContextSegments(
  segments: ContextSegment[],
  capacity: number,
  cells: number,
): { counts: number[]; freeCells: number; ratio: number; over: boolean } {
  const weights = segments.map((s) => Math.max(0, s.tokens));
  const used = weights.reduce((sum, w) => sum + w, 0);
  const over = capacity > 0 && used > capacity;
  const ratio = capacity > 0 ? used / capacity : 0;
  const counts = over
    ? allocateCells(weights, cells)
    : allocateCells([...weights, Math.max(0, capacity - used)], cells).slice(0, segments.length);
  const painted = counts.reduce((sum, c) => sum + c, 0);
  return { counts, freeCells: Math.max(0, cells - painted), ratio, over };
}

/**
 * Segmented context bar: per-segment colored fills, dim idle cells, red on
 * the last segment when over capacity.
 */
export function segmentBar(
  p: Palette,
  segments: ContextSegment[],
  counts: number[],
  freeCells: number,
  over: boolean,
): string {
  let bar = '';
  for (let i = 0; i < segments.length; i++) {
    const n = counts[i] ?? 0;
    if (n <= 0) continue;
    const fill = '█'.repeat(n);
    const last = i === segments.length - 1;
    bar += over && last ? p.red(fill) : p[segments[i]!.color](fill);
  }
  if (freeCells > 0) bar += p.dim('░'.repeat(freeCells));
  return bar;
}

/** Legend pairing each label with its bar color. */
export function contextLegend(p: Palette, segments: ContextSegment[]): string {
  return segments.map((s) => `${p[s.color](s.label)} ${humanTokens(s.tokens)}`).join(' · ');
}

/** Status-bar degradation tier: 0 full → 2 minimal, whole fields, never mid-word. */
export type StatusTier = 0 | 1 | 2;

const APPROVAL_SHORT: Record<string, string> = {
  'read-only': '读',
  'auto-edit': '编',
  full: '全',
};

const APPROVAL_RISK: Record<string, 'green' | 'yellow' | 'red'> = {
  'read-only': 'green',
  'auto-edit': 'yellow',
  full: 'red',
};

/** Approval chip: T0 labeled → T1 risk-colored → T2 single char. */
export function approvalChip(p: Palette, mode: string, tier: StatusTier): string {
  if (tier === 0) return `审批 ${approvalLabel(mode)}`;
  const word = tier === 1 ? approvalLabel(mode) : (APPROVAL_SHORT[mode] ?? approvalLabel(mode));
  const risk = APPROVAL_RISK[mode];
  return risk ? p[risk](word) : word;
}

/** Model short name: drop the provider prefix, the tail is the identity. */
export function modelTail(model: string): string {
  const tail = model.split('/').at(-1) ?? model;
  return tail.length > 0 ? tail : model;
}

export interface ContextGaugeView {
  segments: ContextSegment[];
  used: number;
  capacity: number | undefined;
  compact: number | undefined;
}

/**
 * One breakdown → three gauge forms for the status bar to pick by space:
 * T0 full / T1 compact% only ≥50% / T2 bar+pct only, compact% only ≥70%.
 */
export function contextGaugeForms(
  p: Palette,
  v: ContextGaugeView,
  cols: number,
): [string, string, string] {
  const r = v.compact !== undefined && v.compact > 0 ? v.used / v.compact : undefined;
  const compactTag = (show: boolean): string =>
    r === undefined || !show
      ? ''
      : ` · ${r >= 1 ? p.red(`压缩 ${Math.round(r * 100)}%`) : r >= 0.7 ? p.yellow(`压缩 ${Math.round(r * 100)}%`) : p.dim(`压缩 ${Math.round(r * 100)}%`)}`;
  if (v.capacity === undefined || v.capacity <= 0) {
    const head = `  ${p.dim('上下文')} ${p.bold(humanTokens(v.used))}${p.dim(' tok · 窗口未知')}`;
    return [`${head}${compactTag(true)}`, `${head}${compactTag(r !== undefined && r >= 0.5)}`, head];
  }
  const capacity = v.capacity;
  const form = (tier: StatusTier): string => {
    const cells =
      tier === 2
        ? Math.max(6, Math.min(16, cols - 70))
        : Math.max(8, Math.min(24, cols - 118));
    const { counts, freeCells, over } = planContextSegments(v.segments, capacity, cells);
    const bar = segmentBar(p, v.segments, counts, freeCells, over);
    // pct derives from the SAME used the numbers show — planContextSegments'
    // segment sum is a scaled estimate and can diverge (drift clamping, a
    // zeroed anchor keeping factor=1), which once printed "0/1.05M · 5%".
    const ratio = v.used / capacity;
    const pctNum = Math.round(ratio * 100);
    // A nonzero trickle must not read "0%" next to a near-empty track.
    const pct = (v.used > 0 && pctNum === 0 ? '<1' : String(pctNum)).padStart(2, ' ');
    const pctColor = over || ratio >= 1 ? p.red : ratio >= 0.7 ? p.yellow : p.green;
    const pctTag = ` · ${pctColor(`${pct}%`)}`;
    if (tier === 2) return `  ${bar}${pctTag}${compactTag(r !== undefined && r >= 0.7)}`;
    const nums = p.bold(`${humanTokens(v.used)}/${humanTokens(capacity)}`);
    const line = `  ${p.dim('上下文')} ${bar} ${nums}${pctTag}`;
    return tier === 0 ? `${line}${compactTag(true)}` : `${line}${compactTag(r !== undefined && r >= 0.5)}`;
  };
  return [form(0), form(1), form(2)];
}

const SPARK_CELLS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Value series → sparkline, normalized by the series max. */
export function sparkline(samples: number[]): string {
  const max = Math.max(1, ...samples);
  return samples
    .map((v) => {
      if (v <= 0) return SPARK_CELLS[0]!;
      const idx = Math.min(
        SPARK_CELLS.length - 1,
        Math.round((v / max) * (SPARK_CELLS.length - 1)),
      );
      return SPARK_CELLS[idx]!;
    })
    .join('');
}

/**
 * Right-docked layout: `right` pins to the row end. Falls back to one space
 * when short (callers still clip as backup).
 */
export function padBetween(left: string, right: string, width: number): string {
  const gap = width - styledWidth(left) - styledWidth(right);
  return gap > 1 ? `${left}${' '.repeat(gap)}${right}` : `${left} ${right}`;
}

export { padDisplay } from './text.js';

export interface StatusView {
  cols: number;
  model: string;
  approvalMode: string;
  codeMode: PtcMode;
  pristine: boolean;
  streaming: boolean;
  interruptAt: number;
  inputEmpty: boolean;
  lastCtrlC: number;
  now: number;
  tpsRing: readonly number[];
  /** Real samples in the ring; 0 = nothing streamed yet → hide the gauge
   * (a flat zero bar reads as "broken", exactly what it replaced). */
  tpsSamples: number;
  promptTokens: number;
  cachedTokens: number;
  cacheSeen: boolean;
  gaugeForms: readonly [string, string, string];
}

/** Mode chips: current mode inverted; all three side by side pre-start. */
function modeChips(p: Palette, tier: StatusTier, v: StatusView): string {
  const chip = (m: PtcMode): string =>
    m === v.codeMode ? p.inverse(` ${codeModeLabel(m)} `) : p.dim(` ${codeModeLabel(m)} `);
  const body =
    v.pristine && tier < 2
      ? (['native', 'ptc', 'both'] as PtcMode[]).map((m) => chip(m)).join('')
      : chip(v.codeMode);
  return tier === 0 ? `${p.dim('模式')} ${body}` : body;
}

/**
 * Single-row status bar: `gauge │ model · mode · approval [│ hints]`,
 * tps + cache docked right. Degrades whole fields by priority (T0 → T1 →
 * T2 → drop model), never mid-word. The right cluster is fixed-width so
 * ticks never shift the row.
 */
export function statusBar(p: Palette, v: StatusView): string {
  // Session-cumulative hit rate: per-turn values jitter with backend routing.
  const cacheHit = v.promptTokens > 0 ? Math.round((v.cachedTokens / v.promptTokens) * 100) : 0;
  const bits: string[] = [];
  if (v.tpsSamples > 0) {
    const cur = v.tpsRing[v.tpsRing.length - 1] ?? 0;
    const curStr = String(cur).padStart(3);
    const gauge = `${p.green(sparkline([...v.tpsRing]))} ${p.bold(curStr)}`;
    bits.push(`${p.dim('tps')} ${gauge}`);
  }
  if (v.cacheSeen) bits.push(p.dim(`cache ${String(cacheHit).padStart(2)}%`));
  const right = bits.join(' · ');
  const budget = v.cols - 1;
  if (right.length === 0) return statusLeft(p, 0, false, v);
  const rightW = styledWidth(right);
  const fits = (left: string): boolean => styledWidth(left) + 2 + rightW <= budget;
  // Same tier first drops transient hints, then degrades — hints must not
  // squeeze the used/total numbers off the bar.
  for (const tier of [0, 1, 2] as StatusTier[]) {
    const full = statusLeft(p, tier, false, v, false);
    if (fits(full)) return padBetween(full, right, budget);
    const bare = statusLeft(p, tier, false, v, true);
    if (fits(bare)) return padBetween(bare, right, budget);
  }
  const noModelFull = statusLeft(p, 2, true, v, false);
  if (fits(noModelFull)) return padBetween(noModelFull, right, budget);
  const noModel = statusLeft(p, 2, true, v, true);
  if (fits(noModel)) return padBetween(noModel, right, budget);
  return `${clipToWidth(noModel, Math.max(1, budget - rightW - 2))}  ${right}`;
}

function statusLeft(p: Palette, tier: StatusTier, dropModel: boolean, v: StatusView, noHints = false): string {
  const sep = ` ${p.dim('│')} `;
  const identity: string[] = [];
  if (!dropModel) {
    const model = tier === 0 ? v.model : clipToWidth(modelTail(v.model), tier === 1 ? 22 : 12);
    identity.push(p.bold(model));
  }
  identity.push(modeChips(p, tier, v), approvalChip(p, v.approvalMode, tier));
  let line = `${v.gaugeForms[tier]}${sep}${identity.join(` ${p.dim('·')} `)}`;
  if (noHints) return line;
  if (v.streaming && v.interruptAt > 0) line += sep + p.yellow('■ 等待工具退出…');
  if (!v.streaming && v.inputEmpty && v.now - v.lastCtrlC < 2000) {
    line += sep + p.yellow('再按一次 Ctrl+C 退出');
  }
  return line;
}
