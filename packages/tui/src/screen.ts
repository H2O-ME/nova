import { sanitizeForDisplay } from './sanitize.js';
import { styledWidth } from './width.js';

/**
 * Line-level differential renderer (pi-tui style): the caller supplies the
 * full frame as styled lines; only lines that changed since the previous
 * frame are rewritten. Alternate-screen raw terminal.
 */
export class LineScreen {
  private prev: string[] | undefined;
  private readonly synchronizedOutput: boolean;

  constructor(
    private readonly out: NodeJS.WriteStream & { write(s: string): unknown },
    opts?: { synchronizedOutput?: boolean },
  ) {
    // ?2026（synchronized output）把一帧的全部写入包成一个原子更新：不支持
    // 该私有模式的终端会忽略开关，按普通逐行更新处理。默认关闭——库层行为
    // 不变；cli 经 detectCaps().synchronizedOutput 显式启用。
    this.synchronizedOutput = opts?.synchronizedOutput ?? false;
  }

  get rows(): number {
    return Math.max(1, this.out.rows ?? 24);
  }

  get cols(): number {
    return Math.max(10, this.out.columns ?? 80);
  }

  enter(): void {
    this.out.write('\x1b[?1049h'); // alternate screen
    this.out.write('\x1b[?25l'); // hide cursor
    this.out.write('\x1b[?2004h'); // bracketed paste
    // Wheel tracking (SGR encoding): the alternate screen has no scrollback,
    // so without this the terminal turns wheel notches into arrow keys that
    // clobber the composer's history navigation. Text selection needs Shift.
    this.out.write('\x1b[?1000h');
    this.out.write('\x1b[?1006h');
    this.prev = undefined;
  }

  exit(): void {
    this.out.write('\x1b[?1006l'); // SGR mouse off
    this.out.write('\x1b[?1000l'); // mouse tracking off
    this.out.write('\x1b[?2004l'); // bracketed paste off
    this.out.write('\x1b[?25h'); // show cursor
    this.out.write('\x1b[?1049l'); // leave alternate screen
    this.prev = undefined;
  }

  /** Forget the previous frame: next render repaints everything. */
  invalidate(): void {
    this.prev = undefined;
  }

  /**
   * Render a frame. Lines longer than the terminal width are truncated here;
   * use wrapLine upstream for soft wrapping. `cursor` places the hardware
   * cursor (0-based row within this frame, 0-based display column).
   */
  render(lines: string[], cursor?: { row: number; col: number }): void {
    const rows = this.rows;
    // Never write into the last column: a single off-by-one glyph width would
    // wrap the row, scroll the buffer, and permanently desync the diff cache.
    const safeCols = Math.max(1, this.cols - 1);
    const frame: string[] = [];
    for (let i = 0; i < rows; i++) {
      // Choke point: no unmodeled control write may reach the terminal from a
      // frame line — the diff cache and the screen must stay byte-identical.
      const line = lines[i] === undefined ? undefined : sanitizeForDisplay(lines[i]!);
      if (line === undefined) {
        frame.push('');
      } else if (styledWidth(line) > safeCols) {
        frame.push(truncateStyled(line, safeCols));
      } else {
        frame.push(line);
      }
    }

    if (this.synchronizedOutput) this.out.write('\x1b[?2026h');
    for (let row = 0; row < rows; row++) {
      const next = frame[row] ?? '';
      if (this.prev?.[row] === next) continue;
      // Reset SGR before erasing: a line truncated mid-color leaves style
      // state open, which would otherwise bleed into erase and content.
      this.out.write(`\x1b[${row + 1};1H\x1b[0m\x1b[0K${next}`);
    }
    this.prev = frame;

    if (cursor !== undefined) {
      this.out.write(`\x1b[${Math.min(rows, cursor.row + 1)};${Math.max(1, cursor.col + 1)}H`);
    }
    if (this.synchronizedOutput) this.out.write('\x1b[?2026l');
  }
}

function truncateStyled(line: string, maxWidth: number): string {
  let width = 0;
  // chars (with their widths) kept so far; on overflow the tail is trimmed
  // again to make room for the ellipsis marker itself.
  const kept: Array<{ ch: string; w: number }> = [];
  // eslint-disable-next-line no-control-regex
  const pattern = /\x1b\[[0-9;]*m/g;
  let lastIndex = 0;
  for (;;) {
    const match = pattern.exec(line);
    const plainEnd = match === null ? line.length : match.index;
    for (const ch of line.slice(lastIndex, plainEnd)) {
      const w = styledWidth(ch);
      if (width + w > maxWidth) return `${assemble(kept, maxWidth - styledWidth(ELLIPSIS))}${ELLIPSIS}`;
      kept.push({ ch, w });
      width += w;
    }
    if (match === null) break;
    kept.push({ ch: match[0]!, w: 0 }); // ANSI sequences occupy no columns
    lastIndex = pattern.lastIndex;
  }
  return assemble(kept, maxWidth);
}

const ELLIPSIS = '…';

function assemble(kept: Array<{ ch: string; w: number }>, maxWidth: number): string {
  let width = 0;
  let result = '';
  for (const { ch, w } of kept) {
    if (w > 0 && width + w > maxWidth) break;
    result += ch;
    width += w;
  }
  return result;
}

/**
 * Soft-wrap a styled line to the given display width, preserving ANSI
 * sequences and re-emitting resets/opens across break points. Embedded
 * `\r\n`/`\n` split into separate rows first (streamed assistant text,
 * pretty-printed tool args and error strings all contain raw newlines —
 * writing them inside one frame row would corrupt the whole screen), blank
 * lines are kept, and open styles carry across the break.
 */
export function wrapLine(line: string, width: number): string[] {
  if (width <= 0) return [line];
  const rows: string[] = [];
  let open = '';
  for (const segment of line.replace(/\r\n?/g, '\n').split('\n')) {
    rows.push(...wrapSegment(segment, width, open));
    open = openStyleAtEnd(segment, open);
  }
  return rows;
}

/** SGR state still active at the end of a text run. */
function openStyleAtEnd(text: string, initial: string): string {
  let open = initial;
  // eslint-disable-next-line no-control-regex
  for (const token of text.split(/(\x1b\[[0-9;]*m)/)) {
    if (token.startsWith('\x1b[')) open = token === '\x1b[0m' ? '' : open + token;
  }
  return open;
}

/** Closing CJK punctuation: glues to the preceding char (no break before it). */
// eslint-disable-next-line no-control-regex -- plain unicode class, no controls
const CLOSING_PUNCT = /[，。、；：！？…—」』）］｝》〉】]/;

function wrapSegment(segment: string, width: number, prefixStyle: string): string[] {
  const out: string[] = [];
  let current = prefixStyle;
  let currentWidth = 0;
  let openStyles = prefixStyle;

  // eslint-disable-next-line no-control-regex
  const tokens = segment.split(/(\x1b\[[0-9;]*m)/);
  for (const token of tokens) {
    if (token === '') continue;
    if (token.startsWith('\x1b[')) {
      current += token;
      openStyles = token === '\x1b[0m' ? '' : openStyles + token;
      continue;
    }
    // Break preferentially at spaces and between CJK chars; hard-break long
    // latin words as fallback. Without the CJK rule a whole unbroken Chinese
    // clause became one "word" and wrapped early at the previous space,
    // leaving half the line empty.
    let wordBuffer = '';
    let wordWidth = 0;
    const flushWord = (force: boolean): void => {
      if (wordWidth === 0 && !force) return;
      if (currentWidth + wordWidth > width) {
        out.push(current);
        current = openStyles;
        currentWidth = 0;
      }
      current += wordBuffer;
      currentWidth += wordWidth;
      wordBuffer = '';
      wordWidth = 0;
    };
    for (const ch of token) {
      const w = styledWidth(ch);
      if (ch === ' ') {
        flushWord(false);
        if (currentWidth + 1 > width) {
          out.push(current);
          current = openStyles;
          currentWidth = 0;
        }
        current += ' ';
        currentWidth += 1;
        continue;
      }
      if (w >= 2 && !CLOSING_PUNCT.test(ch)) flushWord(false);
      if (wordWidth + w > width) {
        // single char wider than the line: hard emit
        flushWord(false);
      }
      wordBuffer += ch;
      wordWidth += w;
      if (currentWidth + wordWidth > width) {
        flushWord(true);
      }
    }
    flushWord(false);
  }
  out.push(current);
  return out.filter((l, idx) => idx === 0 || l.length > 0);
}
