/**
 * `git diff` output as rows the 变更 page can draw.
 *
 * The host answers `git_diff` with unified diff text (that is what git prints),
 * and a `<pre>` of it is what this page used to show: no line numbers, no
 * hunks, and no way to tell an added line from a `+` that is part of the
 * content. Parsing it into rows is the same move the reference makes
 * (`dsh-better-sidebar` `diff/rows.ts`, MIT) and the numbers come from the hunk
 * headers, which are the only place git states them.
 *
 * Two guards ride along, both from the reference: a very long line folds to one
 * ellipsized row (its full text stays in the row's `title`), and a file with
 * more than {@link MAX_DIFF_ROWS} rows stops there with a marker rather than
 * laying out a hundred thousand DOM rows.
 *
 * Pure — no React, no DOM — so the parsing rules can be asserted directly.
 */

/** One row of a rendered diff. */
export interface DiffRow {
  kind: 'hunk' | 'ctx' | 'add' | 'del' | 'meta' | 'more';
  /** The line's number on the old side (`null` when the row adds a line). */
  oldNo: number | null;
  /** The line's number on the new side (`null` when the row deletes a line). */
  newNo: number | null;
  /** The row's text, without git's leading sign. */
  text: string;
}

/** Lines longer than this fold to one row (the reference's `FOLD_THRESHOLD`). */
export const FOLD_THRESHOLD = 120;

/**
 * Rows one file's diff renders before it stops.
 *
 * The reference's `MAX_RENDERED_LINES` (`ui-deliverables/src/client/FileDiff.tsx`):
 * a hundred-thousand-row layout is a frozen tab, and a file that big has long
 * since stopped being readable in a side column — the marker says so and the
 * files page opens the whole thing.
 */
export const MAX_RENDERED_LINES = 5000;

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u;

/**
 * Parse one file's unified diff.
 *
 * The file's own header lines (`diff --git`, `index`, `---`, `+++`, mode lines)
 * are dropped: the pane's own head already names the file and its side, so
 * repeating them would be two spellings of one fact. Everything else survives
 * as a row — including git's `\ No newline at end of file`, which is a real
 * statement about the content and reads as `meta`.
 * @param text - the diff text as the host answered it.
 * @returns the rows to draw, in file order.
 */
export function parseUnifiedDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  const lines = text.split('\n');
  // A diff ends with a newline, so `split` leaves one empty tail that is not a
  // line of any file — drawing it would add a phantom context row to every diff.
  // An empty line INSIDE a hunk is real (a blank context line) and stays.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (rows.length >= MAX_RENDERED_LINES) {
      rows.push({ kind: 'more', oldNo: null, newNo: null, text: '' });
      return rows;
    }
    const hunk = HUNK_RE.exec(line);
    if (hunk !== null) {
      oldNo = Number(hunk[1] ?? '0');
      newNo = Number(hunk[3] ?? '0');
      inHunk = true;
      rows.push({ kind: 'hunk', oldNo: null, newNo: null, text: line });
      continue;
    }
    if (!inHunk) continue; // the file header, or a `Binary files … differ` note
    if (line.startsWith('\\')) {
      rows.push({ kind: 'meta', oldNo: null, newNo: null, text: line.slice(1).trim() });
      continue;
    }
    const sign = line.slice(0, 1);
    const body = line.slice(1);
    if (sign === '+') {
      rows.push({ kind: 'add', oldNo: null, newNo, text: body });
      newNo += 1;
    } else if (sign === '-') {
      rows.push({ kind: 'del', oldNo, newNo: null, text: body });
      oldNo += 1;
    } else if (sign === ' ' || line === '') {
      rows.push({ kind: 'ctx', oldNo, newNo, text: sign === ' ' ? body : '' });
      oldNo += 1;
      newNo += 1;
    }
  }
  return rows;
}

/**
 * Whether a row's text is long enough to fold.
 * @param row - the row about to be drawn.
 * @returns true when the row should render as one ellipsized line.
 */
export function folds(row: DiffRow): boolean {
  return row.kind !== 'hunk' && row.kind !== 'more' && row.text.length > FOLD_THRESHOLD;
}

/** How many lines a diff added and removed (the `+N −N` a head reports). */
export function diffStatRows(rows: readonly DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'add') added += 1;
    if (row.kind === 'del') removed += 1;
  }
  return { added, removed };
}

/** One numbered line on one side of a paired row. */
export interface SplitCell {
  no: number;
  text: string;
  kind: 'add' | 'del' | 'ctx';
  /** Index of the source row in the parsed list — the highlight array's key. */
  at: number;
}

/**
 * One drawn line of the side-by-side view: a paired row (either side may be
 * empty, `null`), or a full-width row (`full`) that spans both columns — a
 * hunk header, git's `\ No newline` note, or the truncation marker. The full
 * case carries the row itself; it is drawn exactly as the unified view draws it.
 */
export type SplitLine =
  | { kind: 'pair'; left: SplitCell | null; right: SplitCell | null }
  | { kind: 'full'; row: DiffRow };

/**
 * Pair a parsed diff for the side-by-side view.
 *
 * The reference's rule (`FileDiff.tsx` `splitRows`): each run of deletions is
 * aligned with the run of additions that follows it, row by row; a run that is
 * longer than its partner leaves the short side empty (the `--diff-empty-fill`
 * cell) rather than shifting the rows below; context lines sit on both sides
 * and flush the run. Alignment is what makes the view readable — pairing by
 * index across the whole file would put unrelated lines side by side.
 * @param rows - the parsed rows, in file order.
 * @returns the paired lines.
 */
export function splitRows(rows: readonly DiffRow[]): SplitLine[] {
  const lines: SplitLine[] = [];
  let dels: SplitCell[] = [];
  let adds: SplitCell[] = [];
  const flush = (): void => {
    for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
      lines.push({ kind: 'pair', left: dels[at] ?? null, right: adds[at] ?? null });
    }
    dels = [];
    adds = [];
  };
  rows.forEach((row, at) => {
    if (row.kind === 'del') {
      dels.push({ no: row.oldNo ?? 0, text: row.text, kind: 'del', at });
      return;
    }
    if (row.kind === 'add') {
      adds.push({ no: row.newNo ?? 0, text: row.text, kind: 'add', at });
      return;
    }
    flush();
    if (row.kind === 'ctx') {
      lines.push({
        kind: 'pair',
        left: { no: row.oldNo ?? 0, text: row.text, kind: 'ctx', at },
        right: { no: row.newNo ?? 0, text: row.text, kind: 'ctx', at },
      });
      return;
    }
    lines.push({ kind: 'full', row });
  });
  flush();
  return lines;
}
