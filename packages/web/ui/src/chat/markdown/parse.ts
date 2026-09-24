/**
 * Markdown BLOCK grammar — the pure half of the harness `MarkdownText` port
 * (`ui-primitives/src/markdown/parse.ts` + `render.tsx`'s block switch). The
 * harness parses with micronmark/mdast; this build ships no dependencies, so
 * the same block vocabulary is produced by this line scanner: fenced code,
 * ATX headings, thematic breaks, blockquotes, ordered/unordered lists with
 * GFM task items, pipe tables with column alignment, paragraphs.
 *
 * Two shapes are load-bearing for the ported typography sheet:
 *  - a paragraph keeps its SOURCE LINES (joined by newline when rendered, so
 *    the DOM's whitespace collapsing turns them into a space, as the harness's
 *    interleaved newline text nodes do), and
 *  - a table's column count decides `md-table-wide` (≥4 columns) at render
 *    time, so alignment/row shapes stay raw here.
 *
 * Nothing in this file touches the DOM or React: it is asserted directly.
 */

/** One column's alignment, straight off the delimiter row (`:---:` forms). */
export type MdAlign = 'left' | 'center' | 'right' | null;

/** One list item: its block children plus its GFM task state when it has one. */
export interface MdItem {
  children: MdBlock[];
  checked?: boolean;
}

export type MdBlock =
  | { t: 'p'; lines: string[] }
  | { t: 'h'; level: number; text: string }
  | { t: 'hr' }
  | { t: 'code'; lang: string | undefined; code: string }
  | { t: 'quote'; children: MdBlock[] }
  | { t: 'list'; ordered: boolean; start: number; loose: boolean; items: MdItem[] }
  | { t: 'table'; align: MdAlign[]; head: string[]; rows: string[][] };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const TASK_RE = /^\[([ xX])\][ \t]+/;

/** Parse a whole markdown document into its blocks. */
export function parseMarkdown(text: string): MdBlock[] {
  return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'));
}

/** Parse one container's lines (the document root, a quote body, a list item). */
export function parseBlocks(lines: string[]): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence !== null && (fence[1] ?? '').length >= 3) {
      const marker = fence[1] ?? '```';
      const end = fenceEnd(lines, i, marker);
      const info = (fence[2] ?? '').trim();
      // The grammar id truncates at the first non-word character (the harness
      // recovered it from the hast `language-*` class the same way).
      const lang = /^[\w-]+/.exec(info)?.[0];
      out.push({ t: 'code', lang: lang === undefined || lang === '' ? undefined : lang, code: lines.slice(i + 1, end).join('\n') });
      i = end + 1;
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      out.push({ t: 'h', level: (heading[1] ?? '#').length, text: heading[2] ?? '' });
      i += 1;
      continue;
    }
    if (HR_RE.test(line)) {
      out.push({ t: 'hr' });
      i += 1;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const quoted = QUOTE_RE.exec(lines[i] ?? '');
        if (quoted === null) break;
        body.push(quoted[1] ?? '');
        i += 1;
      }
      out.push({ t: 'quote', children: parseBlocks(body) });
      continue;
    }
    const list = LIST_RE.exec(line);
    if (list !== null) {
      const parsed = parseList(lines, i);
      out.push(parsed.block);
      i = parsed.next;
      continue;
    }
    const table = parseTable(lines, i);
    if (table !== null) {
      out.push(table.block);
      i = table.next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim().length > 0 && !isBlockStart(lines, i)) {
      para.push(lines[i] ?? '');
      i += 1;
    }
    // Defensive: `isBlockStart` is true at i when we got here without pushing,
    // so the loop always advanced; this guard keeps an empty paragraph out.
    if (para.length > 0) out.push({ t: 'p', lines: para });
    else i += 1;
  }
  return out;
}

/**
 * Index of the fence's closing line, or the last line when it never closes.
 * The closer is the same marker repeated at least as many times as the opener
 * opened with, so a ```` block may contain a ``` line (CommonMark).
 */
function fenceEnd(lines: string[], start: number, marker: string): number {
  const closer = new RegExp(`^ {0,3}\\${marker[0] ?? '`'}{${marker.length},}[ \\t]*$`);
  for (let i = start + 1; i < lines.length; i += 1) {
    if (closer.test(lines[i] ?? '')) return i;
  }
  return lines.length;
}

/** True when the line opens a block of its own (paragraphs stop there). */
function isBlockStart(lines: string[], i: number): boolean {
  const line = lines[i] ?? '';
  const fence = FENCE_RE.exec(line);
  if (fence !== null && (fence[1] ?? '').length >= 3) return true;
  return (
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line) ||
    tableDelimiter(lines, i) !== null
  );
}

/**
 * Consume one list. Items keep their content indent-stripped body lines, so a
 * nested list inside an item parses through the same block scanner; a list is
 * loose when a blank line separates any of its blocks (the harness reads the
 * same flag off mdast's `spread`).
 */
function parseList(lines: string[], start: number): { block: MdBlock; next: number } {
  const first = LIST_RE.exec(lines[start] ?? '');
  const indent = (first?.[1] ?? '').length;
  const ordered = first !== null && /\d/.test(first[2] ?? '');
  const startAt = ordered ? Number.parseInt((first?.[2] ?? '1').replace(/[.)]$/, ''), 10) : 1;
  const items: MdItem[] = [];
  let i = start;
  let loose = false;
  while (i < lines.length) {
    const marker = LIST_RE.exec(lines[i] ?? '');
    if (marker === null) break;
    if ((marker[1] ?? '').length !== indent) break;
    if (/\d/.test(marker[2] ?? '') !== ordered) break;
    const contentIndent = indent + (marker[2] ?? '').length + (marker[3] ?? '').length;
    const body: string[] = [marker[4] ?? ''];
    i += 1;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      const nextMarker = LIST_RE.exec(line);
      if (line.trim().length === 0) {
        // A blank line may end the item or separate its blocks: only a
        // following line that still belongs to this item keeps it open.
        const following = lines[i + 1] ?? '';
        if (following.trim().length === 0) break;
        const belongs = belongsToItem(following, indent, ordered);
        if (!belongs) break;
        body.push('');
        loose = true;
        i += 1;
        continue;
      }
      if (nextMarker !== null && (nextMarker[1] ?? '').length === indent && /\d/.test(nextMarker[2] ?? '') === ordered) break;
      // A nested list at any deeper indent, or a continuation indented to the
      // item's content column, stays inside this item.
      if (leadingSpaces(line) >= contentIndent || (nextMarker !== null && (nextMarker[1] ?? '').length > indent) || isLazyContinuation(line)) {
        body.push(dedent(line, contentIndent));
        i += 1;
        continue;
      }
      break;
    }
    items.push(withTask(parseBlocks(body)));
  }
  return { block: { t: 'list', ordered, start: startAt, loose, items }, next: i };
}

/** Does a line after a blank still belong to the item above it? */
function belongsToItem(line: string, indent: number, ordered: boolean): boolean {
  const marker = LIST_RE.exec(line);
  if (marker !== null) return (marker[1] ?? '').length > indent || (/\d/.test(marker[2] ?? '') === ordered && (marker[1] ?? '').length === indent);
  return leadingSpaces(line) > indent;
}

/** A plain, unindented line is a lazy paragraph continuation of the item. */
function isLazyContinuation(line: string): boolean {
  return !isBlockStart([line], 0) && leadingSpaces(line) > 0;
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n += 1;
  return n;
}

function dedent(line: string, columns: number): string {
  let n = 0;
  while (n < line.length && n < columns && (line[n] === ' ' || line[n] === '\t')) n += 1;
  return line.slice(n);
}

/** Read the GFM task marker off an item's leading paragraph. */
function withTask(children: MdBlock[]): MdItem {
  const head = children[0];
  if (head === undefined || head.t !== 'p') return { children };
  const task = TASK_RE.exec(head.lines[0] ?? '');
  if (task === null) return { children };
  const rest = (head.lines[0] ?? '').slice(task[0].length);
  const lines = rest.length > 0 ? [rest, ...head.lines.slice(1)] : head.lines.slice(1);
  return {
    children: lines.length > 0 ? [{ t: 'p', lines }, ...children.slice(1)] : children.slice(1),
    checked: (task[1] ?? '').toLowerCase() === 'x',
  };
}

/** The delimiter row under a header line, or null when this is no table. */
function tableDelimiter(lines: string[], i: number): MdAlign[] | null {
  const head = lines[i] ?? '';
  const separator = lines[i + 1] ?? '';
  if (!head.includes('|') || !separator.includes('-') || !/^[\s|:-]+$/.test(separator)) return null;
  const cells = splitRow(separator);
  const header = splitRow(head);
  if (cells.length !== header.length || cells.length === 0) return null;
  if (cells.some((cell) => !/^:?-+:?$/.test(cell))) return null;
  return cells.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

function parseTable(lines: string[], start: number): { block: MdBlock; next: number } | null {
  const align = tableDelimiter(lines, start);
  if (align === null) return null;
  const head = splitRow(lines[start] ?? '');
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0 || !line.includes('|')) break;
    if (FENCE_RE.test(line) || HEADING_RE.test(line)) break;
    rows.push(splitRow(line));
    i += 1;
  }
  return { block: { t: 'table', align, head, rows }, next: i };
}

/** Cells of one pipe row: outer pipes optional, `\|` escapes stay in-cell. */
export function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}