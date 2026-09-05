/** Display-width of a string (East Asian wide chars count as 2 columns). */

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

/**
 * East Asian "ambiguous" width characters that this UI emits. On CJK-configured
 * terminals (zh-CN Windows, CJK fonts) they render 2 columns wide while a
 * plain count says 1 — undercounting makes full-width status/composer rows
 * wrap in the terminal, scroll the frame, and desync the whole display.
 * Counting them as 2 only ever costs an earlier (cosmetic) truncation.
 */
const AMBIGUOUS_RANGES: Array<[number, number]> = [
  [0x00b7, 0x00b7], // · middle dot
  [0x2013, 0x2014], // – — dashes
  [0x2020, 0x2022], // † ‡ •
  [0x2026, 0x2026], // … ellipsis
  [0x2103, 0x2103], // ℃
  [0x2190, 0x21ff], // ← ↑ → ↓ and friends (status bar, popup hints)
  [0x22ef, 0x22ef], // ⋯ midline ellipsis
  [0x2303, 0x23ff], // ⏎ return symbol and other technical pictographs
  [0x2500, 0x25ff], // box drawing (╭─╮│╰╯), blocks (█ ░), geometric shapes
  [0x2600, 0x27bf], // misc symbols + dingbats (✓ ✗ ⚠ ★)
  [0x2768, 0x2775], // ❯ chevrons and light brackets (composer/approval marker)
  [0x27f0, 0x27ff], // ⟳ supplemental arrows (retry line)
  [0x2800, 0x28ff], // braille patterns (spinner frames)
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
  if (inRanges(code, WIDE_RANGES)) return 2;
  if (inRanges(code, AMBIGUOUS_RANGES)) return 2;
  return 1;
}

export function stringWidth(text: string): number {
  let total = 0;
  for (const ch of text) {
    total += charWidth(ch.codePointAt(0) ?? 0);
  }
  return total;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Display width of a string that may contain ANSI SGR sequences. */
export function styledWidth(text: string): number {
  return stringWidth(text.replace(ANSI_PATTERN, ''));
}
