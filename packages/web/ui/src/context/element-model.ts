/**
 * The Context pane's element reading: the units the window is MADE OF.
 *
 * Split from `context-model.ts` because it answers the question behind the
 * composition bar — "系统提示 1,552" is a number, and this is the list of rows
 * that number is the sum of.
 */
import type { ContextCategory, ContextElement } from '../types.js';
import { CATEGORY_COLOR, CATEGORY_ORDER, categoryLabel, percentOf } from './context-model.js';

/** One row of the element board: a live unit of the window. */
export interface ElementRow {
  key: string;
  label: string;
  tokens: number;
  /** Share of the live total, 0..100. */
  pct: number;
  /** Opening characters, when the fold kept them (schemas carry none). */
  preview?: string;
}

/** One category's card: its header reading and the rows inside it. */
export interface ElementGroup {
  cat: ContextCategory;
  label: string;
  /** The category's hue: the header's dot and the composition bar's slot agree. */
  color: string;
  count: number;
  tokens: number;
  /** Share of the live total, 0..100. */
  pct: number;
  /** The group's elements, heaviest first. */
  rows: ElementRow[];
}

/** The element board: one card per non-empty category, in reading order. */
export interface ElementBoard {
  groups: ElementGroup[];
}

/**
 * The window's elements, folded into one card per category.
 *
 * `live.elements` already excludes what a compaction took off the surface (the
 * fold's contract), so every row here is ON the window and the shares are shares
 * of the live total. The GROUPING is the reference browser's shape and it is what
 * makes the board readable: a flat heaviest-first list is dominated by a dozen
 * tool schemas of ~1% each, where the entries that actually carry the window get
 * lost. Each card states its own count and total; its rows are heaviest-first.
 * @param elements - the live elements, in arrival order.
 * @param liveTotal - the live estimate (`live.total`), the share denominator.
 * @returns the category cards, non-empty categories only, in reading order.
 */
export function elementBoard(elements: readonly ContextElement[], liveTotal: number): ElementBoard {
  const groups: ElementGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const own = elements.filter((element) => element.cat === cat);
    if (own.length === 0) continue;
    const rows: ElementRow[] = own
      .map((element, index) => ({
        key: `e${index}-${element.seq}`,
        label: element.label,
        tokens: element.tokens,
        pct: percentOf(element.tokens, liveTotal),
        ...(element.preview !== undefined ? { preview: element.preview } : {}),
      }))
      .sort((a, b) => b.tokens - a.tokens);
    const tokens = own.reduce((sum, element) => sum + element.tokens, 0);
    groups.push({
      cat,
      label: categoryLabel(cat),
      color: CATEGORY_COLOR[cat],
      count: own.length,
      tokens,
      pct: percentOf(tokens, liveTotal),
      rows,
    });
  }
  return { groups };
}
