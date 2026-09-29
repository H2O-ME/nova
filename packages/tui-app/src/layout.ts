/**
 * Screen metrics, ported value-for-value from the grok pager (M11 批4).
 *
 * The point of collecting them here is that the old TUI let every component
 * compute its own width, pad its own rows and pick its own fallback tier, so
 * one wrong sum misaligned a whole block. Every number below is a *decision*
 * with a name; components take them from here instead of re-deriving them.
 */

/** Column the row marker (`❯` `•` `⠙` `▌` `◈`) starts at. */
export const MARK_LEAD = 2;
/** The marker column itself — the same 2-cell inset the cards use. */
export const MARK_COL = MARK_LEAD;
/** One cell of air between the marker and its content. */
export const MARK_GAP = 1;
/** Column every block's text starts at (grok's content column). */
export const CONTENT_COL = MARK_COL + MARK_GAP;

/** Blank rows between two adjacent entries. */
export const GAP_BETWEEN = 1;
/** …except inside a dense run (consecutive collapsed tool rows). */
export const GAP_DENSE = 0;
/** A user prompt carries its own leading breath on top of the pair gap. */
export const USER_VPAD = 1;

/** The transcript is the only shrinking region; it never goes below this. */
export const SCROLLBACK_MIN_ROWS = 5;

/** Bottom chrome (status bar, hint bar) insets to the card's left edge. */
export const CHROME_PAD_COLS = 2;
/** Composer card's horizontal inner padding (left and right). */
export const COMPOSER_PAD_COLS = 2;
/** A draft composer is always this tall before it grows. */
export const COMPOSER_ROWS = 3;
/** Cards (composer, welcome, approval, panels) are rounded with this corner set. */
export const CARD_CORNERS = { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯', h: '─', v: '│' } as const;

/** One clock for every animation: the shell increments a counter at this cadence. */
export const TICK_MS = 33;
/** Spinner advances every N ticks (~132ms per frame, grok's beat). */
export const SPINNER_DIVISOR = 4;
/** Animated accent-bar wave: `sin²(tick * RAIL_SPEED + row / WAVE_ROWS * 2π)`. */
export const RAIL_SPEED = 0.15;
export const RAIL_WAVE_ROWS = 32;

/** Columns a tool row may use once its own content inset is subtracted. */
export function toolBudget(cols: number): number {
  return Math.max(8, cols - 1 - CONTENT_COL);
}

/**
 * Columns the bottom chrome (and every card) is wide, starting at
 * `CHROME_PAD_COLS`: the row's total width is `CHROME_PAD_COLS + chromeWidth`,
 * which is `cols - 1` — the last column is never written into, because one
 * off-by-one glyph would wrap the row and desync the terminal's own scroll.
 */
export function chromeWidth(cols: number): number {
  return Math.max(10, cols - 1 - CHROME_PAD_COLS);
}

/**
 * The bottom stack: transcript → breathing row → popups → queue lane → live
 * turn row → composer card → status bar → hint bar. Only the transcript
 * shrinks; every other row is fixed height, which is why the whole layout can
 * be computed top-down from a row count.
 */
export interface BottomStack {
  /** Rows the transcript region is allowed to occupy. */
  transcript: number;
  /** Blank breathing rows between the transcript and whatever comes next. */
  breath: number;
  popup: number;
  queue: number;
  /** The live turn row: one row while a turn runs, none when it ends. */
  turn: number;
  composer: number;
  status: number;
  hints: number;
}

export function bottomStack(rows: number, parts: Omit<BottomStack, 'transcript' | 'breath'>): BottomStack {
  const fixed = parts.popup + parts.queue + parts.turn + parts.composer + parts.status + parts.hints;
  const breath = rows - fixed > SCROLLBACK_MIN_ROWS + 1 ? 1 : 0;
  const transcript = Math.max(1, rows - fixed - breath);
  return { transcript, breath, ...parts };
}