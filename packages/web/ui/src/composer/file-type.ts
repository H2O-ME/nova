/**
 * File classification and size text for the composer's attachment rail, ported
 * from deepseek-harness `ui-primitives` (`file-size.ts`, `FileTypeIcon.tsx`'s
 * extension tables — MIT License): a pending file card names the file, its
 * extension and its size, and draws a glyph for the category.
 *
 * The tables keep the reference's own entries and its lookup order (a known
 * filename beats the extension). Two deliberate differences from the source:
 * the code-file subsystem (`code-file-types.ts`) is not ported — it exists to
 * give Flutter/Dart/… their own marks on top of its own default, and this rail
 * draws one `code` glyph — so the ordinary source extensions the reference
 * resolves through that subsystem are listed here instead (without them every
 * `.ts`/`.py` file would fall to the generic grey glyph).
 */

/** File categories with distinct glyphs (the reference's closed union, minus its code subtypes). */
export type FileType =
  | 'code'
  | 'excel'
  | 'folder'
  | 'html'
  | 'image'
  | 'markdown'
  | 'other'
  | 'pdf'
  | 'ppt'
  | 'video'
  | 'word';

/** Extension → category (the reference's `EXTENSION_TYPES`). */
const EXTENSION_TYPES: Readonly<Record<string, FileType>> = {
  scss: 'code',
  sass: 'code',
  less: 'code',
  vue: 'code',
  svelte: 'code',
  astro: 'code',
  bat: 'code',
  cmd: 'code',
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  kt: 'code',
  swift: 'code',
  c: 'code',
  h: 'code',
  cc: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  php: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  ps1: 'code',
  toml: 'code',
  yaml: 'code',
  yml: 'code',
  json: 'code',
  xml: 'code',
  sql: 'code',
  csv: 'excel',
  tsv: 'excel',
  html: 'html',
  htm: 'html',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  tif: 'image',
  tiff: 'image',
  heic: 'image',
  heif: 'image',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  pdf: 'pdf',
  ppt: 'ppt',
  pptx: 'ppt',
  key: 'ppt',
  mp4: 'video',
  mov: 'video',
  m4v: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  mpg: 'video',
  mpeg: 'video',
  doc: 'word',
  docx: 'word',
  rtf: 'word',
  odt: 'word',
  pages: 'word',
  xls: 'excel',
  xlsx: 'excel',
  xlsm: 'excel',
  xlsb: 'excel',
  xlt: 'excel',
  xltx: 'excel',
  xltm: 'excel',
  ods: 'excel',
  ots: 'excel',
  fods: 'excel',
  numbers: 'excel',
};

/** Known filename → category, checked before the extension (the reference's `NAME_TYPES`). */
const NAME_TYPES: Readonly<Record<string, FileType>> = {
  changelog: 'markdown',
  contributing: 'markdown',
  readme: 'markdown',
  dockerfile: 'code',
  makefile: 'code',
};

/** The last path segment, for either separator. */
export function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/**
 * The final suffix of a path, case preserved; empty when there is no dot.
 * @param path - a path or bare filename, either separator.
 * @returns the characters after the basename's final dot.
 */
export function fileExtension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1);
}

/**
 * Classify a path for file-card presentation: a known filename wins over the
 * extension, and anything unrecognised falls to `other` (never to a wrong
 * glyph).
 *
 * Both tables are object literals, so both lookups use `Object.hasOwn`: a file
 * named `constructor` (or `x.constructor`) would otherwise resolve to an
 * inherited member and hand a function to the icon, which renders it.
 * @param path - a path or bare filename, either separator.
 * @returns the file's category.
 */
export function classifyFileType(path: string): FileType {
  const name = basename(path).toLowerCase();
  if (Object.hasOwn(NAME_TYPES, name)) return NAME_TYPES[name] as FileType;
  const ext = fileExtension(name).toLowerCase();
  return Object.hasOwn(EXTENSION_TYPES, ext) ? EXTENSION_TYPES[ext] as FileType : 'other';
}

/**
 * A byte count as compact user-facing size text (`312B`, `4.2KB`, `1.5MB`).
 * Value-for-value the reference's `fileSizeText`: one decimal below ten of the
 * chosen unit, whole units above it.
 * @param bytes - exact byte count.
 * @returns the size text.
 */
export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : String(Math.round(kb))}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : String(Math.round(mb))}MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : String(Math.round(gb))}GB`;
}

/**
 * The card's second line: what the file is and how big it is, as the reference
 * builds it (`[extension, size]`, empty parts dropped) — a file without an
 * extension shows its size alone rather than a stray space.
 * @param name - the file's name (the card's first line).
 * @param bytes - the exact byte count.
 * @returns the meta line's text.
 */
export function fileMetaText(name: string, bytes: number): string {
  // The reference uppercases and caps the extension at eight characters so a
  // pathological suffix cannot push the size out of the 240px card.
  const extension = fileExtension(name).toUpperCase().slice(0, 8);
  return [extension, fileSizeText(bytes)].filter((part) => part !== '').join(' ');
}
