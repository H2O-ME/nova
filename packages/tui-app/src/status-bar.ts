/**
 * The single status line (M11 批4): `上下文仪表 │ 模型 · 模式 · 审批 │ tps · cache`.
 *
 * Two decisions this file owns, both learned the hard way in the old TUI:
 *
 *  - **Space is given up by whole fields, never by cutting a word.** There are
 *    five named tiers below; each one is a complete, readable line, and the
 *    first one that fits the terminal wins. Within a tier the transient hint
 *    (an interrupt notice) is dropped first, because a hint is a nicety and
 *    the numbers are not.
 *  - **The right cluster has a fixed width and the digits are padded, not
 *    re-laid-out.** A tps readout that grows a digit must not slide the
 *    separators; scrolling must not restyle the bar (scroll position is
 *    visible in the frame itself).
 */
import type { ApprovalMode, PtcMode } from '@nova-agent/core';
import { paint, usageUrgency, type Palette } from './theme.js';

/** Widths of the two separator kinds. They are NOT interchangeable. */
export const GROUP_SEP = ' │ ';
export const ITEM_SEP = ' · ';

export interface GaugeZones {
  prompt: number;
  schema: number;
  fragment: number;
  skills: number;
  messages: number;
}

export interface StatusInput {
  cols: number;
  usedTokens: number;
  contextWindow: number | null;
  /** Per-zone token split of `usedTokens` (grok's segmented bar). */
  zones?: GaugeZones;
  model: string;
  codeMode: PtcMode;
  approvalMode: ApprovalMode;
  /** Tokens per second over the live ring window; hidden when unknown. */
  tps?: number | null;
  /** Session cache hit rate 0..1. Sticky: the shell passes a value once seen. */
  cacheHitRate?: number | null;
  /** Auto-compact proximity 0..1 — printed only when it is actually close. */
  compactRatio?: number | null;
  /** Interrupt/exit notice: first thing dropped when space runs out. */
  transient?: string;
}

export interface StatusView {
  line: string;
  /** Column range of the gauge field (hover hit-testing); absent when dropped. */
  gaugeCols?: { start: number; end: number };
}

const MODE_WORDS: Record<PtcMode, string> = { native: '普通', ptc: 'PTC', both: '混合' };
const APPROVAL_WORDS: Record<ApprovalMode, string> = { 'read-only': '只读', 'auto-edit': '自动编辑', full: '全放行' };
const APPROVAL_CHARS: Record<ApprovalMode, string> = { 'read-only': '读', 'auto-edit': '编', full: '全' };

/** A degradation tier: each field is either drawn at some fidelity or dropped. */
interface Tier {
  gauge: 'full' | 'numbers' | 'none';
  model: 'full' | 'bare' | 'truncated' | 'none';
  labels: boolean;
  approval: 'word' | 'char' | 'none';
  transient: boolean;
}

/**
 * The tiers, widest first. Their order is the priority list, and the rule that
 * produced it is: **the numbers outlive everything**. A gauge that survived
 * while the number it draws vanished would be decoration; a model name that
 * outlived it would be vanity (the banner and `/model` both show it). The
 * transient hint goes first of all — it is a nicety, not information.
 */
const TIERS: readonly Tier[] = [
  { gauge: 'full', model: 'full', labels: true, approval: 'word', transient: true },
  { gauge: 'full', model: 'bare', labels: false, approval: 'word', transient: true },
  { gauge: 'full', model: 'bare', labels: false, approval: 'char', transient: false },
  { gauge: 'numbers', model: 'bare', labels: false, approval: 'char', transient: false },
  { gauge: 'numbers', model: 'truncated', labels: false, approval: 'char', transient: false },
  { gauge: 'numbers', model: 'none', labels: false, approval: 'char', transient: false },
  { gauge: 'numbers', model: 'none', labels: false, approval: 'none', transient: false },
  { gauge: 'none', model: 'none', labels: false, approval: 'none', transient: false },
];

export function statusLine(input: StatusInput, palette: Palette): StatusView {
  const right = rightCluster(input, palette);
  for (const tier of TIERS) {
    const built = assemble(input, palette, tier, right);
    if (built.line.length <= input.cols) return built;
  }
  return { line: '', gaugeCols: undefined };
}

function assemble(input: StatusInput, palette: Palette, tier: Tier, right: string): StatusView {
  const gauge = tier.gauge === 'none' ? undefined : gaugeField(input, palette, tier.gauge);
  const middle = middleGroup(input, palette, tier);
  const parts: string[] = [];
  let gaugeCols: { start: number; end: number } | undefined;
  if (gauge !== undefined) {
    gaugeCols = { start: 0, end: gauge.length };
    parts.push(gauge);
  }
  if (middle.text.length > 0) parts.push(middle.text);
  if (input.transient !== undefined && tier.transient) parts.push(paint(palette, palette.warn, input.transient));
  if (parts.length === 0 && right.length === 0) return { line: '', gaugeCols: undefined };
  const left = parts.join(GROUP_SEP);
  // The right cluster is pushed to the edge; when there is no room for the gap
  // it simply trails the left (a squeezed bar is better than a broken one).
  const gap = right.length > 0 && input.cols - left.length - right.length > 0 ? 1 : 0;
  const pad = Math.max(0, input.cols - left.length - right.length - gap);
  return { line: `${left}${' '.repeat(pad)}${' '.repeat(gap)}${right}`, ...(gaugeCols !== undefined ? { gaugeCols } : {}) };
}

/** `模型 · 模式 · 审批`, at the tier's fidelity. */
function middleGroup(input: StatusInput, palette: Palette, tier: Tier): { text: string } {
  const items: string[] = [];
  const model = modelText(input.model, tier.model);
  if (model !== undefined) items.push(paint(palette, palette.text, model));
  if (tier.labels) items.push(paint(palette, palette.dim, MODE_WORDS[input.codeMode]));
  else if (tier.approval !== 'none') items.push(paint(palette, palette.dim, compactMode(input.codeMode)));
  if (tier.approval === 'word') items.push(paint(palette, palette.dim, APPROVAL_WORDS[input.approvalMode]));
  else if (tier.approval === 'char') items.push(paint(palette, palette.dim, APPROVAL_CHARS[input.approvalMode]));
  return { text: items.join(ITEM_SEP) };
}

/** `PTC` / `普通` in one character, for the narrow tiers. */
function compactMode(mode: PtcMode): string {
  return mode === 'native' ? '普' : mode === 'ptc' ? 'P' : '混';
}

function modelText(model: string, fidelity: Tier['model']): string | undefined {
  if (fidelity === 'none') return undefined;
  // The provider prefix is noise once space is tight; the model id is the fact.
  const bare = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  if (fidelity === 'full') return model;
  if (fidelity === 'bare') return bare;
  return bare.length > 16 ? `${bare.slice(0, 15)}…` : bare;
}

/** `4.2k/128k · 33%` with the segmented bar, or just the numbers. */
function gaugeField(input: StatusInput, palette: Palette, fidelity: 'full' | 'numbers'): string | undefined {
  const total = input.contextWindow;
  if (total === null || total <= 0) return undefined;
  const used = Math.max(0, input.usedTokens);
  const ratio = Math.min(1, used / total);
  const label = `${humanTokens(used)}/${humanTokens(total)} · ${Math.round(ratio * 100)}%`;
  const colored = paint(palette, usageUrgency(ratio, palette), `${palette.bold}${label}${palette.reset}`);
  const compact = compactSuffix(input, palette);
  if (fidelity === 'numbers') return compact === '' ? colored : `${colored} ${compact}`;
  const cells = 8;
  const filled = Math.round(ratio * cells);
  if (filled === 0) return compact === '' ? colored : `${colored} ${compact}`;
  return `${bar(input, palette, cells, filled)} ${colored}${compact === '' ? '' : ` ${compact}`}`;
}

/** Segmented by zone, so the bar says *what* the context is made of. */
function bar(input: StatusInput, palette: Palette, cells: number, filled: number): string {
  const zones = input.zones;
  const order: Array<[keyof GaugeZones, string]> = [
    ['prompt', palette.zonePrompt],
    ['schema', palette.zoneSchema],
    ['fragment', palette.zoneFragment],
    ['skills', palette.zoneSkills],
    ['messages', palette.zoneMessages],
  ];
  if (zones === undefined) return paint(palette, usageUrgency(filled / cells, palette), '█'.repeat(filled)) + paint(palette, palette.dim, '░'.repeat(cells - filled));
  const total = order.reduce((sum, [key]) => sum + Math.max(0, zones[key] ?? 0), 0);
  let drawn = 0;
  let out = '';
  for (const [key, color] of order) {
    const share = total === 0 ? 0 : Math.round((Math.max(0, zones[key] ?? 0) / total) * filled);
    const take = Math.min(share, filled - drawn);
    if (take > 0) {
      out += paint(palette, color, '█'.repeat(take));
      drawn += take;
    }
  }
  if (drawn < filled) out += paint(palette, palette.text, '█'.repeat(filled - drawn));
  if (filled < cells) out += paint(palette, palette.dim, '░'.repeat(cells - filled));
  return out;
}

/** `压缩 62%` appears only when compaction is actually approaching. */
function compactSuffix(input: StatusInput, palette: Palette): string {
  const ratio = input.compactRatio;
  if (ratio === null || ratio === undefined || ratio < 0.5) return '';
  return paint(palette, palette.warn, `压缩 ${Math.round(ratio * 100)}%`);
}

/** `tps · cache`, fixed width so ticks never move the separators. */
function rightCluster(input: StatusInput, palette: Palette): string {
  const items: string[] = [];
  if (input.tps !== null && input.tps !== undefined && input.tps > 0) {
    items.push(paint(palette, palette.ok, `⚡${input.tps.toFixed(1).padStart(5)}`));
  }
  if (input.cacheHitRate !== null && input.cacheHitRate !== undefined) {
    items.push(paint(palette, palette.dim, `cache ${String(Math.round(input.cacheHitRate * 100)).padStart(3)}%`));
  }
  return items.join(ITEM_SEP);
}

export function humanTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}