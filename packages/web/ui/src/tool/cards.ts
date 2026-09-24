/**
 * Card data derivations: the shapes a tool card draws from. Pure, DOM-free, and
 * the place the collapsed/folded arithmetic lives.
 *
 * Ported from deepseek-harness (MIT): `ui-primitives/head-tail-cap.ts` (the
 * head/tail split), `ui-primitives/DiffBlock.tsx` (`contentLines`' terminator
 * rule and the copy text), `ui-tool/toolviews/plan-summary.ts` (the
 * parallel-active plan summary) and the `read.*` / `search.*` locale templates.
 * The interleaved diff rows themselves come from our own `diff-lines.ts`, which
 * is the one place this surface differs from the harness by design (the harness
 * prints the removed block then the added block).
 */
import { collapseContext, diffLines, diffStats, type DiffRow } from '../diff-lines.js';

/** One file's interleaved diff rows, ready to draw. */
export interface DiffFile {
  path: string;
  /** Content rows: context, added, removed and skip markers, in file order. */
  rows: readonly DiffRow[];
  added: number;
  removed: number;
}

/**
 * Interleave each file's change with our line diff (`diff-lines.ts`) and collapse
 * long unchanged runs, so a two-line change in a 200-line file stays two screens
 * short.
 */
export function diffFiles(diffs: readonly { path: string; oldText: string | null; newText: string }[]): DiffFile[] {
  return diffs.map((diff) => {
    const ops = diffLines(diff.oldText, diff.newText);
    const { added, removed } = diffStats(ops);
    return { path: diff.path, rows: collapseContext(ops), added, removed };
  });
}

/** Added/removed totals across files — what the collapsed row and the footer print. */
export function diffTotals(diffs: readonly { path: string; oldText: string | null; newText: string }[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const file of diffFiles(diffs)) {
    added += file.added;
    removed += file.removed;
  }
  return { added, removed };
}

/**
 * The diff text a reader copies: what the card shows, row for row, with the
 * `-`/`+` prefixes and the path headers that keep a multi-file copy
 * attributable (harness `DiffBlock.copyText`).
 */
export function diffCopyText(files: readonly DiffFile[]): string {
  const lines: string[] = [];
  for (const file of files) {
    lines.push(file.path);
    for (const row of file.rows) {
      if (row.t === 'skip') lines.push(`⋯ ${row.n} 行未变`);
      else if (row.t === 'add') lines.push(`+ ${row.text}`);
      else if (row.t === 'del') lines.push(`- ${row.text}`);
      else lines.push(`  ${row.text}`);
    }
  }
  return lines.join('\n');
}

/** Content lines without the terminating newline (harness `DiffBlock.contentLines`). */
export function contentLines(text: string): string[] {
  if (text === '') return [];
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n');
}

/** A read window: the lines the tool returned, numbered as the file numbers them. */
export interface ReadWindow {
  /** 1-based file line number of the window's first line. */
  offset: number;
  /** The window's text lines, terminator stripped. */
  lines: readonly string[];
  /**
   * The file's exact total when the tool's header stated one, else `null`
   * (unknown). A header-less result is everything the tool returned, so the
   * window cannot know a total the tool never gave.
   */
  total: number | null;
}

const WINDOW_HEADER_RE = /^\[lines (\d+)-(\d+) of (\d+)\]\n?/;

/**
 * Split a read result into its numbered window. The tool's own `[lines A-B of N]`
 * header (the `read_file` contract) carries the offset and the file's total;
 * without it the window is the whole text and its total is unknown. A trailing
 * newline is a terminator, not an empty last line.
 *
 * This deliberately does not take the result card's `lineCount`: that field
 * describes the host's result view, not the text in hand, and a `list_dir` view
 * counts entries while its text also carries a `(... N more)` marker line — so
 * using it as a denominator claimed `显示 501 / 500 行` for a capped listing.
 * The window's total comes from the header the text itself carries.
 */
export function readWindow(text: string): ReadWindow {
  const header = WINDOW_HEADER_RE.exec(text);
  const offset = header === null ? 1 : Number(header[1]);
  const total = header === null ? null : Number(header[3]);
  const body = header === null ? text : text.slice(header[0].length);
  return { offset, total, lines: contentLines(body) };
}

/** One file's matches, in first-seen file order. */
export interface SearchGroup {
  path: string;
  /** 1-based line numbers; empty for a name-mode path row. */
  lines: number[];
}

/** Group a flat location list by file, preserving the result's order. */
export function searchGroups(matches: readonly { path: string; line?: number | undefined }[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const index = new Map<string, number>();
  for (const match of matches) {
    const at = index.get(match.path);
    if (at === undefined) {
      index.set(match.path, groups.length);
      groups.push({ path: match.path, lines: match.line === undefined ? [] : [match.line] });
      continue;
    }
    const group = groups[at];
    if (group !== undefined && match.line !== undefined) group.lines.push(match.line);
  }
  return groups;
}

/**
 * The banner summary over a search card — the harness `search.*` templates. The
 * cap clause needs a pre-cap total; our result card reports truncation without
 * one, so a capped search whose total is unknown says `（已达上限）` instead of
 * printing `显示 X / 共 X`, which would claim the truncated list is complete.
 */
export function searchSummary(input: {
  mode: 'content' | 'name';
  shown: number;
  total: number | null;
  files: number;
  truncated: boolean;
}): string {
  const { mode, shown, total, files, truncated } = input;
  const unit = mode === 'name' ? '个路径' : '处匹配';
  if (!truncated) return mode === 'name' ? `${shown} 个路径` : `${shown} 处匹配 · ${files} 个文件`;
  if (total === null) return mode === 'name' ? `${shown} 个路径（已达上限）` : `${shown} 处匹配 · ${files} 个文件（已达上限）`;
  return mode === 'name' ? `显示 ${shown} / 共 ${total} 个路径` : `显示 ${shown} / 共 ${total} ${unit} · ${files} 个文件`;
}

/**
 * The read banner's window note (`read.window`), only when the read is a slice.
 * With a stated total it is a fraction; a result cut without one (a capped
 * `list_dir`) has no denominator to print, so it says `（已截断）` rather than
 * inventing one — same discipline as `searchSummary`'s `（已达上限）`.
 */
export function readWindowNote(window: ReadWindow, truncated: boolean): string {
  const shown = `显示 ${window.lines.length} 行`;
  if (window.total === null) return truncated ? `${shown}（已截断）` : shown;
  return `显示 ${window.lines.length} / ${window.total} 行`;
}

/**
 * Prompt label for a working directory (harness `TerminalBlock.promptLabel`):
 * `~` for the home directory itself, otherwise the path's last segment (both
 * separators accepted, trailing separators ignored), falling back to the path
 * itself when it has no segment.
 */
export function promptLabel(cwd: string, home: string | undefined): string {
  const trimmed = cwd.replace(/[/\\]+$/, '');
  if (home !== undefined && trimmed === home.replace(/[/\\]+$/, '')) return '~';
  const segment = trimmed.split(/[/\\]/).pop();
  return segment === undefined || segment === '' ? cwd : segment;
}

const HIT_RE = /^(.+?):(\d+): (.*)$/;

/**
 * The matched text of a `content_regex` search, keyed `path:line`.
 *
 * Stopgap for a gap in the result card: `SearchResultView.matches` carries
 * locations only (`{ path, line }`), so the text a reader actually wants to read
 * has no field to arrive in. This re-reads the tool's own result format
 * (`path:line: text` — the same shape its `presentResult` parses) instead of
 * printing bare line numbers. The proper fix is a `text` field per match on
 * `SearchResultView`; when that lands this parser goes away.
 */
export function matchTexts(output: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const line of contentLines(output)) {
    const hit = HIT_RE.exec(line);
    if (hit === null) continue;
    texts.set(`${hit[1]}:${hit[2]}`, hit[3] ?? '');
  }
  return texts;
}

/** The search card's copy text: the whole result, whatever the card is showing. */
export function searchCopyText(groups: readonly SearchGroup[], texts: ReadonlyMap<string, string>): string {
  return groups
    .map((group) =>
      group.lines.length === 0
        ? group.path
        : [group.path, ...group.lines.map((line) => `${line}: ${texts.get(`${group.path}:${line}`) ?? ''}`)].join('\n'),
    )
    .join('\n\n');
}

/** One plan item, as the `todo_write` card carries it. */
export interface PlanItem {
  text: string;
  status: string;
}

export interface PlanSummary {
  done: number;
  total: number;
  /** First `in_progress` item's text, or null when it is missing or blank. */
  activeContent: string | null;
  /** Active items beyond the first; 0 whenever there is no `activeContent` to sit beside. */
  activeExtra: number;
  /** The items currently in progress, whatever the summary could name. */
  active: number;
}

/**
 * Counts plus the summary halves (harness `planSummary`): several items may be
 * in progress at once, so the row names the first and counts the rest instead of
 * silently dropping them.
 */
export function planSummary(items: readonly PlanItem[]): PlanSummary {
  const active = items.filter((item) => item.status === 'in_progress');
  const first = active[0]?.text;
  const named = typeof first === 'string' && first.trim() !== '';
  return {
    done: items.filter((item) => item.status === 'completed').length,
    total: items.length,
    activeContent: named ? first : null,
    activeExtra: named ? active.length - 1 : 0,
    active: active.length,
  };
}

/** The head/tail split metrics for a capped list (port of `head-tail-cap.ts`). */
export interface HeadTailCap {
  hidden: number;
  capped: boolean;
  headLines: number;
  tailLines: number;
}

export function headTailCap(total: number, maxLines: number, expanded: boolean): HeadTailCap {
  const hidden = total - maxLines;
  const headLines = Math.ceil(maxLines / 2);
  return { hidden, capped: hidden > 0 && !expanded, headLines, tailLines: maxLines - headLines };
}

/** Fold-toggle copy, harness verbatim (`… 其余 {n} 行` / `收起…`). */
export interface FoldLabels {
  expand: (hidden: number) => string;
  expandAria: (hidden: number) => string;
  collapse: string;
  collapseAria: string;
}

/**
 * The shared fold control's copy: `tail` is the unit the expand aria label names
 * (`''` for a read or search result, `输出` for terminal output, `差异` for a
 * diff), `noun` what the collapse aria label names.
 */
export function foldLabels(tail: string, noun: string): FoldLabels {
  return {
    expand: (hidden) => `… 其余 ${hidden} 行`,
    expandAria: (hidden) => `展开其余 ${hidden} 行${tail}`,
    collapse: '收起',
    collapseAria: `收起${noun}`,
  };
}