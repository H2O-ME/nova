/**
 * The approval detail's row model: a tool's `preview` lines → the rows the card
 * draws (the diff body's `path` / `del` / `add` / dim-metadata vocabulary).
 *
 * Pure and DOM-free so the fold can be asserted directly. The lines arrive
 * already prefixed by the tool (`edit_file` emits `- old` / `+ new` under a
 * `编辑 path（N 处替换）：` header, `write_file` a two-line 写入/首行 summary —
 * see `plugins/builtin/fs.ts`), so this module CLASSIFIES and strips; it never
 * re-derives a diff (the tool already knows what the edit does, and an LCS over
 * its pre-diffed lines would invent a second answer).
 *
 * The `- `/`+ ` prefixes are stripped here and redrawn by the stylesheet's
 * `::before` (the harness DiffBlock rule): what the user copies is what the
 * card shows, and the sign never doubles.
 */
export interface PreviewRow {
  /** `path` header / `del` / `add` / `dim` (metadata, truncation markers). */
  kind: 'path' | 'del' | 'add' | 'dim';
  /** The line's text, without its `- `/`+ ` prefix. */
  text: string;
}

/** The +/- totals the block's footer prints. */
export interface PreviewStats {
  added: number;
  removed: number;
}

/**
 * Classify one preview line. The FIRST line is the tool's own header when it
 * carries no diff prefix (it names the path and the effect: `编辑 …（2 处替换）：`),
 * which is why it reads as the block's `path` row even though it is prose — it
 * is the line the rest of the block is about.
 */
export function previewRows(preview: readonly string[]): PreviewRow[] {
  const rows: PreviewRow[] = [];
  preview.forEach((line, index) => {
    if (line.startsWith('+ ')) rows.push({ kind: 'add', text: line.slice(2) });
    else if (line.startsWith('- ')) rows.push({ kind: 'del', text: line.slice(2) });
    else if (index === 0) rows.push({ kind: 'path', text: line });
    else rows.push({ kind: 'dim', text: line });
  });
  return rows;
}

/** Added/removed line counts — the numbers the footer prints. */
export function previewStats(rows: readonly PreviewRow[]): PreviewStats {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'add') added += 1;
    else if (row.kind === 'del') removed += 1;
  }
  return { added, removed };
}

/** Whether a preview is worth a block at all (empty previews render nothing). */
export function hasPreview(preview: readonly string[] | undefined): preview is readonly string[] {
  return preview !== undefined && preview.length > 0;
}