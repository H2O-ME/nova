/**
 * Syntax highlighting for the changes page's diff pane, on top of the chat
 * markdown highlighter (the one scanner per language family — reusing it is
 * the single-implementation rule; a diff-specific tokenizer would be a second
 * scanner to keep in step).
 *
 * The reference highlights its diff rows; the honest port highlights the
 * CONTENT rows (context / added / removed) and leaves structural rows (hunk,
 * header, fold marker) to their own styles. The whole file's content is
 * scanned ONCE and zipped back onto the rows in order — per-row scanning
 * would lose multi-line block-comment state across rows, which is exactly the
 * state a scanner threads.
 *
 * Pure functions, no React, no DOM: the render side reads the returned runs
 * and colors them with the same token variables the code blocks use.
 */
import { highlightLines, type HlLine } from '../chat/markdown/highlight.js';
import type { DiffRow } from './git-diff-rows.js';

/** Extension → the scanner id `highlightLines` reads, for paths (not fences). */
const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'cs',
  kotlin: 'kotlin', kt: 'kotlin', swift: 'swift', php: 'php', scala: 'scala', dart: 'dart',
  css: 'css', scss: 'scss', less: 'less',
  go: 'go', rs: 'rs', py: 'py',
  sh: 'sh', bash: 'bash', zsh: 'zsh',
  json: 'json', jsonc: 'jsonc', json5: 'json',
  yml: 'yml', yaml: 'yaml', toml: 'toml', ini: 'ini', conf: 'conf', properties: 'properties', env: 'env',
};

/**
 * The scanner id for one file path, or undefined when no scanner reads it —
 * the same "unknown means plain" rule the fence renderer applies.
 * @param path - the file path (any separator style).
 */
export function langOfPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  // `<= 0`: no dot at all, or a dotfile (.gitignore has no extension to read).
  if (dot <= 0) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return Object.hasOwn(EXT_LANG, ext) ? EXT_LANG[ext] : undefined;
}

/** Whether a row carries file content the scanner should read. */
function isContentRow(row: DiffRow): boolean {
  return row.kind === 'ctx' || row.kind === 'add' || row.kind === 'del';
}

/**
 * Highlight one diff's content rows.
 * @param rows - the parsed diff rows, in file order.
 * @param path - the file path the diff belongs to (picks the scanner).
 * @returns one run list per row (content rows only, in order); `undefined`
 *   means "render this row plain" — structural rows, or a language without a
 *   scanner.
 */
export function highlightDiffRows(rows: readonly DiffRow[], path: string): readonly (HlLine | undefined)[] {
  const lang = langOfPath(path);
  const content = rows.filter(isContentRow).map((row) => row.text).join('\n');
  const lines = lang === undefined ? undefined : highlightLines(content, lang);
  if (lines === undefined) return rows.map(() => undefined);
  // The scanner is lossless and splits on every newline, so one entry per
  // content row, in the same order the rows carry — zip them back.
  let at = 0;
  return rows.map((row) => (isContentRow(row) ? lines[at++] : undefined));
}
