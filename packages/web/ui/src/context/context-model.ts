/**
 * The Context pane's shared vocabulary and its head cards' reading: what a
 * category is, and how full the window is RIGHT NOW.
 *
 * Pure functions only — no React, no DOM — so the panel's decisions can be
 * asserted directly, exactly as `card-view.ts` serves the tool cards and
 * `trace-view.ts` the log rows. The trend, element and activity readings live in
 * their own files (`trend-model.ts`, `element-model.ts`, `activity-model.ts`),
 * each importing this one's category table rather than restating it.
 *
 * Shares come in two denominators, and the split is deliberate: the BAR lays
 * out against the window (so the unfilled remainder is visible), while the
 * legend and tooltips report shares of the OCCUPIED total (so a percentage
 * answers "of what is in there"). Both are computed here, once.
 */
import type { CSSProperties } from 'react';
import type { ContextBreakdown, ContextCategory, ContextTimeline } from '../types.js';
import { cacheHitText } from '../format.js';

/** Every category, in the order a reader accounts for a window. */
export const CATEGORY_ORDER: readonly ContextCategory[] = ['system', 'tools', 'injected', 'user', 'assistant', 'tool'];

const CATEGORY_LABEL: Record<ContextCategory, string> = {
  system: '系统提示',
  tools: '工具定义',
  injected: '注入上下文',
  user: '用户输入',
  assistant: '助手回复',
  tool: '工具结果',
};

/**
 * The hue CSS variables that paint each category. Drawn from the token layer's
 * own static palette (design-platform.css), so the panel is colour-blind-safe
 * and every slot stays legible in both themes. A static table, never a
 * string-built token name: the guard that checks every consumed token is
 * declared can only follow a name it can read.
 */
export const CATEGORY_COLOR: Record<ContextCategory, string> = {
  system: 'var(--dsw-static-indigo-500)',
  tools: 'var(--dsw-static-amber-500)',
  injected: 'var(--dsw-static-purple-500)',
  user: 'var(--dsw-static-green-500)',
  assistant: 'var(--dsw-static-blue-500)',
  tool: 'var(--dsw-static-teal-500)',
};

/** A category's drawn label (the legend, the chips, the stack's tooltips). */
export function categoryLabel(cat: ContextCategory): string {
  return CATEGORY_LABEL[cat];
}

/**
 * The entrance cascades' stagger slot (`--lc-i`): sheets delay by
 * `calc(var(--lc-i, 0) * <step>)`, so elements sweep in left to right. The slot
 * is CAPPED — a long log must not wait for its column — and the cap lives here
 * so the composition bar's segments and the trend's bars cascade identically.
 */
export const STAGGER_CAP = 20;

export function staggerStyle(index: number): CSSProperties {
  return { '--lc-i': Math.min(index, STAGGER_CAP) } as CSSProperties;
}

/** Percent 0..100 of a total, rounded; an empty total reads 0 rather than dividing. */
export function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/** One category's drawn slot in a composition bar. */
export interface CategorySlot {
  cat: ContextCategory;
  tokens: number;
  /** 0..1 of the bar, never exceeding 1 (the denominator is the window when known). */
  share: number;
  label: string;
  /** The CSS variable that paints the slot (a design-token color, never a literal). */
  color: string;
}

/** The composition bar's slots, in a fixed order, each pinned to its share. */
export function compositionSlots(cats: ContextBreakdown, window?: number): CategorySlot[] {
  const total = Object.values(cats).reduce((sum, value) => sum + value, 0);
  const capacity = window !== undefined && window > 0 ? window : total;
  const denominator = capacity === 0 ? 1 : capacity;
  return CATEGORY_ORDER.map((cat) => {
    const tokens = cats[cat] ?? 0;
    return {
      cat,
      tokens,
      share: Math.min(1, tokens / denominator),
      label: CATEGORY_LABEL[cat],
      color: CATEGORY_COLOR[cat],
    };
  });
}

/**
 * One drawn segment of a composition bar, positioned in the bar's own
 * percentages so the element and the hover bubble agree about where the
 * segment is (no viewer-side measurement can disagree with the style).
 */
export interface BarSegment {
  cat: ContextCategory;
  label: string;
  color: string;
  tokens: number;
  /** Left edge / width, as percentages of the bar track (0..100). */
  left: number;
  width: number;
  /** The tooltip's anchor (% of the track) — the segment's own centre. */
  center: number;
  /** Share of the bar's own occupied total, 0..100 (what the legend reports). */
  pct: number;
}

/** The composition bar: its segments, and how much of the scale they fill. */
export interface CompositionBar {
  segments: BarSegment[];
  /** 0..100 of the scale the segments occupy; the rest is the unfilled track. */
  usedPercent: number;
  /** The denominator the widths were laid out against (the window, or the estimate when over). */
  scale: number;
}

/**
 * The composition bar, in ONE derivation: the widths, the free remainder and
 * the hover anchors all come from the same share table.
 *
 * The scale is the window when known — but an estimate can exceed it (the
 * window shrinks on a model switch after a long session), and a bar drawn
 * against the old window would silently overflow its own track. So the scale is
 * `max(window, used)`: the bar saturates, and every segment keeps the share it
 * has in the overflowed reading.
 * @param cats - the live per-category estimate.
 * @param window - the model's window, when the host knows it.
 * @returns the segments, the occupied percentage and the scale used.
 */
export function compositionBar(cats: ContextBreakdown, window?: number): CompositionBar {
  const used = Object.values(cats).reduce((sum, value) => sum + value, 0);
  const scale = window !== undefined && window > 0 ? Math.max(window, used) : used;
  const slots = compositionSlots(cats, scale);
  let cursor = 0;
  const segments = slots.map((slot) => {
    const width = slot.share * 100;
    const segment: BarSegment = {
      cat: slot.cat,
      label: slot.label,
      color: slot.color,
      tokens: slot.tokens,
      left: cursor,
      width,
      // The geometric centre: keeping a bubble inside the card is the view's
      // business (its own clamp), not the reading's.
      center: cursor + width / 2,
      pct: percentOf(slot.tokens, used),
    };
    cursor += width;
    return segment;
  });
  return { segments, usedPercent: percentOf(used, scale === 0 ? 1 : scale), scale };
}

/**
 * The headline: how full the window is, as tokens and as 0..1.
 *
 * The DENOMINATOR is not this pane's to decide — it is passed in, because the
 * composer's ring already reads it (the `ready` frame's `contextWindow`, moved
 * by a model switch), and a second reading of "how big is this model" would be
 * the second place the answer could go stale. Undefined means unknown: the pane
 * then states the estimate and draws no percentage rather than inventing a
 * denominator.
 */
export function occupancy(timeline: ContextTimeline, window?: number): { tokens: number; window?: number; ratio?: number } {
  const tokens = timeline.live.total;
  if (window === undefined || window <= 0) return { tokens };
  return { tokens, window, ratio: Math.min(1, tokens / window) };
}

/** One cell of the stats strip. */
export interface StatCell {
  key: 'turns' | 'requests' | 'toolCalls' | 'cache';
  label: string;
  value: string;
}

/**
 * The stats strip's cells: the session's shape, plus the cache-hit reading of
 * the NEWEST request that reported usage.
 *
 * The hit figure is the kernel's own (the same `cacheHitText` the chat's usage
 * pill reads), so the strip and the transcript cannot disagree; no reported
 * usage yet renders a dash rather than a zero.
 * @param timeline - the fold's reading.
 * @returns the four cells in reading order.
 */
export function statCells(timeline: ContextTimeline): StatCell[] {
  let hit: string | undefined;
  for (const point of [...timeline.points].reverse()) {
    if (point.prompt !== undefined && point.prompt > 0 && point.cached !== undefined) {
      hit = cacheHitText(point.cached, point.prompt);
      break;
    }
  }
  return [
    { key: 'turns', label: '轮次', value: String(timeline.counts.turns) },
    { key: 'requests', label: '请求', value: String(timeline.counts.requests) },
    { key: 'toolCalls', label: '工具调用', value: String(timeline.counts.toolCalls) },
    { key: 'cache', label: '缓存命中', value: hit !== undefined ? `${hit}%` : '—' },
  ];
}
