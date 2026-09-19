/**
 * The scrollback state machine — the heart of the port (M11 批4).
 *
 * Entries in, screen rows out. It owns three decisions that used to be spread
 * across every component of the old TUI:
 *
 *  1. **Breathing.** Two adjacent entries are separated by one blank row, with
 *     a single exception: a run of *dense* entries (consecutive collapsed tool
 *     rows) keeps none. A turn with thirty tool calls must not read as a string
 *     of blank lines, and a prompt→thinking→answer sequence must not read as
 *     one solid brick. An entry may also carry its own pad (`vpad`) — a user
 *     prompt does: one blank row above and one below, which is what makes a new
 *     question read as a new question rather than as another paragraph.
 *  2. **Anchoring.** The newest line sits at the bottom, just above the
 *     composer; the leftover blank space floats *up*, above the content.
 *     **This one is deliberately not grok's behaviour**: grok top-aligns short
 *     transcripts (its `max_scroll_offset()` is 0, so slack accumulates below
 *     the content), while the M10 work on real machines found the inverse
 *     reads better — blank at the top edge reads as "there is history above",
 *     blank at the bottom reads as "this is where you type". The single
 *     exception is the welcome card, which centers (there is no history for
 *     the blank to refer to).
 *  3. **Geometry.** A prefix-sum layout cache maps a screen row back to an
 *     entry index, so hit-testing a click is a binary search instead of a
 *     re-render, and scrolling is arithmetic on one offset.
 *
 * Pure: no terminal, no timers, no styling decisions — entries arrive already
 * wrapped to the content width by the caller, which keeps this file testable
 * with plain strings.
 */
import { GAP_BETWEEN, GAP_DENSE } from './layout.js';

export interface ScrollEntry {
  id: string;
  /** Display lines, already wrapped to the content width (styled or plain). */
  lines: readonly string[];
  /** Consecutive dense entries (collapsed tool rows) share no gap between them. */
  dense: boolean;
  /** Blank rows above *and* below this entry (skipped above at the very top). */
  vpad?: number;
  /**
   * This entry reads as its own page: when it is the whole transcript, it
   * centers instead of hugging the bottom. Only the welcome card sets it.
   */
  center?: boolean;
}

export interface ScrollLayout {
  /** Row index (within content) of each entry's first line. */
  starts: number[];
  /** Blank rows inserted after entry i (0 for the last entry). */
  gaps: number[];
  /** Total content rows. */
  height: number;
}

export interface Viewport {
  /** Exactly `rows` screen rows, top→bottom, blank-filled. */
  screen: string[];
  /** Entry index owning each screen row; -1 = blank. */
  owner: number[];
  /** Rows of content scrolled past above the viewport. */
  above: number;
  /** Rows of content below the viewport (0 while pinned to the bottom). */
  below: number;
  /** True while the newest content is on screen. */
  atBottom: boolean;
}

export function layoutEntries(entries: readonly ScrollEntry[]): ScrollLayout {
  const starts: number[] = [];
  const gaps: number[] = [];
  let y = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const pad = entry.vpad ?? 0;
    // A leading pad only means something when something precedes it; the
    // trailing half always applies (grok's `[vpad_top] lines [vpad_bottom]`).
    if (i > 0) y += pad;
    starts.push(y);
    y += entry.lines.length + pad;
    const next = entries[i + 1];
    const gap = next === undefined ? 0 : entry.dense && next.dense ? GAP_DENSE : GAP_BETWEEN;
    gaps.push(gap);
    y += gap;
  }
  // The trailing gap is not carried: the blank between the newest line and the
  // composer is the bottom stack's `breath` row, not a property of the last
  // entry — one source of truth for that blank instead of two.
  const height = entries.length === 0 ? 0 : y - (gaps[gaps.length - 1] ?? 0);
  return { starts, gaps, height };
}

export class Scrollback {
  private entries: readonly ScrollEntry[] = [];
  private layout: ScrollLayout = layoutEntries([]);
  /** Rows scrolled up from the bottom (0 = pinned to the newest line). */
  private offset = 0;

  setEntries(entries: readonly ScrollEntry[]): void {
    this.entries = entries;
    this.layout = layoutEntries(entries);
    this.offset = clamp(this.offset, 0, this.maxOffset());
  }

  get contentHeight(): number {
    return this.layout.height;
  }

  get scrollOffset(): number {
    return this.offset;
  }

  get atBottom(): boolean {
    return this.offset === 0;
  }

  /** Rows currently scrolled past above the viewport at this row budget. */
  maxOffset(rows = 0): number {
    return Math.max(0, this.layout.height - Math.max(0, rows));
  }

  scrollBy(delta: number, rows: number): void {
    this.offset = clamp(this.offset + delta, 0, this.maxOffset(rows));
  }

  scrollToBottom(): void {
    this.offset = 0;
  }

  /** Entry index owning a content row (-1 for a gap row). */
  entryAtRow(row: number): number {
    const { starts, gaps } = this.layout;
    for (let i = starts.length - 1; i >= 0; i--) {
      const start = starts[i]!;
      if (row < start) continue;
      const end = start + this.entries[i]!.lines.length;
      if (row < end) return i;
      if (row < end + (gaps[i] ?? 0)) return -1; // inside the gap after entry i
      return -1;
    }
    return -1;
  }

  /**
   * The visible slice. Content is bottom-anchored; an entry marked `center`
   * that turns out to be the whole transcript (the welcome card) centers
   * instead, because there is no history above it for the blank to refer to.
   */
  viewport(rows: number): Viewport {
    const height = this.layout.height;
    const screen = Array.from<string>({ length: rows }, () => '');
    const owner = Array.from<number>({ length: rows }, () => -1);
    if (rows <= 0) return { screen, owner, above: 0, below: 0, atBottom: true };

    const center = this.entries.length === 1 && this.entries[0]!.center === true && height < rows;
    const topPad = center ? Math.floor((rows - height) / 2) : Math.max(0, rows - Math.min(rows, height));
    const start = center ? 0 : Math.max(0, height - rows - this.offset);
    const visible = Math.min(height - start, rows);

    for (let i = 0; i < visible; i++) {
      const row = start + i;
      const line = this.lineAt(row);
      if (line === undefined) continue;
      screen[topPad + i] = line;
      owner[topPad + i] = this.entryAtRow(row);
    }
    return {
      screen,
      owner,
      above: start,
      below: Math.max(0, height - start - visible),
      atBottom: this.offset === 0,
    };
  }

  private lineAt(row: number): string | undefined {
    const index = this.indexAtRow(row);
    if (index === undefined) return undefined;
    const { entry, lineIndex } = index;
    return entry.lines[lineIndex];
  }

  /** Binary search the entry containing a content row. */
  private indexAtRow(row: number): { entry: ScrollEntry; lineIndex: number } | undefined {
    const { starts } = this.layout;
    let lo = 0;
    let hi = starts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid]! <= row) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return undefined;
    const entry = this.entries[found]!;
    const lineIndex = row - starts[found]!;
    return lineIndex < entry.lines.length ? { entry, lineIndex } : undefined;
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}