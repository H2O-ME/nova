/**
 * Display sanitizer for external content (tool output, model text, command
 * args). The line-diff renderer assumes screen content equals the frame
 * string byte-for-byte — any control sequence we do not model poisons the
 * diff cache permanently (e.g. `\x1b[2K` from a colored child process moves
 * the real cursor/erases rows while `prev` still remembers the old text).
 *
 * Contract: keep SGR sequences, remove every other escape, drop carriage
 * control without ever *adding* a newline (one injected `\n` at the render
 * choke point would scroll the buffer and desync the diff cache forever),
 * expand tabs, drop the remaining C0/C1/DEL code points. Residual printable
 * bytes from exotic sequences (DCS/PM/SOS) may stay visible — visible text
 * cannot corrupt the screen, control writes can.
 */
const ESCAPES =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;]*m|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-~]|\r\n?|\t|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]|\x1b/g;

/** Tab expansion width — aligned with common editor defaults. */
const TAB_WIDTH = 4;

export function sanitizeForDisplay(text: string): string {
  if (!text.includes('\x1b') && !CONTROLS_RE.test(text)) return text;
  CONTROLS_RE.lastIndex = 0;
  return text.replace(ESCAPES, (seq) => {
    if (seq.startsWith('\x1b[')) return seq.endsWith('m') ? seq : '';
    if (seq === '\r\n') return '\n'; // \r\n normalization keeps existing \n
    if (seq === '\r') return ''; // lone CR overwrite semantics: not emulated
    if (seq === '\t') return ' '.repeat(TAB_WIDTH);
    return ''; // OSC body, ESC Fe/=/DCS lead, bare ESC, C0/C1/DEL
  });
}

// eslint-disable-next-line no-control-regex
const CONTROLS_RE = /[\r\t\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/;
