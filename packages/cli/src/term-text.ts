/**
 * Terminal text primitives for the line-oriented surfaces (REPL + exec's human
 * output). They used to live in the standalone `tui` package — the one that
 * owned the full-screen TUI's cell grid, key decoding and screen diffing. With
 * the TUI gone (the browser UI is the rich surface), only these measurements
 * survive, and they belong next to their one consumer.
 *
 * Column arithmetic must agree with what the terminal paints: East Asian wide
 * glyphs take 2 cells, and the ambiguous glyphs this CLI emits (box drawing,
 * arrows, the ellipsis) are painted 1 cell wide by modern terminals.
 */

const ZERO_WIDTH_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f], // combining diacritics
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f], // variation selectors
];

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi
  [0x3041, 0x33ff], // Hiragana .. CJK compatibility
  [0x3400, 0x4dbf], // CJK ext A
  [0x4e00, 0x9fff], // CJK unified
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff], // emoji (faces, symbols, transport, supplement — 🚀 lives here)
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

/** Glyphs measured at their rendered (1-cell) width even though Unicode says ambiguous. */
const NARROW_AMBIGUOUS_RANGES: Array<[number, number]> = [
  [0x2013, 0x2014], // – — dashes
  [0x2020, 0x2022], // † ‡ •
  [0x2026, 0x2026], // … ellipsis
  [0x2103, 0x2103], // ℃
  [0x2303, 0x23ff], // ⏎ and other technical pictographs
  [0x2600, 0x276b], // misc symbols + dingbats (✓ ✗ ⚠ ★), ❬❭❮❯ included
  [0x2770, 0x27bf], // light brackets and the remaining dingbats
  [0x27f0, 0x27ff], // ⟳ supplemental arrows (retry line)
];

function inRanges(code: number, ranges: Array<[number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}

export function charWidth(code: number): number {
  if (code === 0) return 0;
  if (inRanges(code, ZERO_WIDTH_RANGES)) return 0;
  return inRanges(code, WIDE_RANGES) ? 2 : 1;
}

/** Display width of one line: wide glyphs 2 cells, ambiguous glyphs 1. */
export function stringWidth(text: string): number {
  let total = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    total += inRanges(code, NARROW_AMBIGUOUS_RANGES) ? 1 : charWidth(code);
  }
  return total;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Display width of a string that may carry ANSI SGR sequences. */
export function styledWidth(text: string): number {
  return stringWidth(text.replace(ANSI_PATTERN, ''));
}

/** Colour capability of this terminal (what the palette choice needs). */
export interface TerminalCaps {
  color: boolean;
}

/**
 * NO_COLOR (https://no-color.org/) and TERM=dumb force no colour; anything
 * else on a TTY gets the ANSI-16 palette. Truecolor detection went away with
 * the TUI: the REPL's palette is ANSI-16 in every terminal.
 */
export function detectCaps(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = process.stdout.isTTY === true,
): TerminalCaps {
  const term = env['TERM'] ?? '';
  return { color: isTTY && env['NO_COLOR'] === undefined && term !== 'dumb' };
}