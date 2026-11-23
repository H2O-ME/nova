/**
 * File-type glyphs for the workspace tree's file rows.
 *
 * The tree's own anatomy (2026-11-24, ZCode alignment): a directory row carries
 * a chevron and NOTHING else — the reference draws no folder glyph, so a
 * directory's name starts where the file names do one level down
 * (`WorkspaceFileTreeRowView.tsx:296-315`) — while a file row leads with its
 * TYPE's glyph, so the shape says "source / data / image / archive" before the
 * name is read. Nova drew one generic document outline for every file and a
 * folder on every directory, which is the flatness the operator rejected.
 *
 * Five families and one fallback, on the shared 16-box / 1.5-stroke grid (the
 * `icons.tsx` harness: CSS sizes the glyph, the attribute is the floor). Colour
 * lives in the sheet (`[data-kind]`), because a file-type hue is a property of
 * the surface, not of the drawing.
 */

/** The families the tree distinguishes. */
export type FileKind = 'code' | 'config' | 'markup' | 'image' | 'archive' | 'document';

/** Extension → family. The keys are lower-case and carry no dot. */
const EXTENSIONS: Readonly<Record<string, FileKind>> = {
  // Source in any language the product's own workspaces carry.
  ts: 'code', tsx: 'code', mts: 'code', cts: 'code',
  js: 'code', jsx: 'code', mjs: 'code', cjs: 'code',
  py: 'code', rs: 'code', go: 'code', java: 'code', kt: 'code', swift: 'code',
  c: 'code', h: 'code', cc: 'code', cpp: 'code', hpp: 'code', cs: 'code',
  rb: 'code', php: 'code', lua: 'code', sh: 'code', bash: 'code', ps1: 'code',
  sql: 'code', vue: 'code', svelte: 'code',
  // Structured data and configuration.
  json: 'config', jsonc: 'config', json5: 'config',
  yaml: 'config', yml: 'config', toml: 'config', ini: 'config', env: 'config',
  lock: 'config', conf: 'config', xml: 'config', csv: 'config',
  // Markup and style sheets.
  html: 'markup', htm: 'markup', css: 'markup', scss: 'markup', less: 'markup',
  md: 'document', mdx: 'document', txt: 'document', rst: 'document', log: 'document',
  // Media.
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  avif: 'image', bmp: 'image', ico: 'image', svg: 'image',
  // Archives.
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive',
  '7z': 'archive', rar: 'archive', xz: 'archive', zst: 'archive',
};

/**
 * The family a file name belongs to.
 * @param name - the row's leaf name (a path is accepted; only the leaf is read).
 * @returns the family, or `document` when the extension is unknown or absent.
 */
export function fileKindOf(name: string): FileKind {
  const leaf = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = leaf.lastIndexOf('.');
  // A dot-file (`.gitignore`) has its dot at index 0: that is a name, not an
  // extension, and it carries no family — the document glyph draws it.
  if (dot <= 0 || dot === leaf.length - 1) return 'document';
  return EXTENSIONS[leaf.slice(dot + 1).toLowerCase()] ?? 'document';
}

/**
 * One family's glyph.
 * @param props.kind - the family from {@link fileKindOf}.
 * @param props.className - the sheet's class (size + ink).
 * @returns the glyph.
 */
export function FileKindIcon({ kind, className }: { kind: FileKind; className?: string }): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      data-kind={kind}
    >
      {pathFor(kind)}
    </svg>
  );
}

function pathFor(kind: FileKind): JSX.Element {
  switch (kind) {
    // Source: the two angle brackets, the one shape every editor uses for it.
    case 'code':
      return <><path d="M5.9 5.1 2.6 8l3.3 2.9" /><path d="M10.1 5.1 13.4 8l-3.3 2.9" /></>;
    // Structured data: braces.
    case 'config':
      return (
        <>
          <path d="M6.2 2.6c-1.5 0-1.4 1.5-1.4 2.6 0 1-.3 1.6-1.3 2.1v1.4c1 .5 1.3 1.1 1.3 2.1 0 1.1-.1 2.6 1.4 2.6" />
          <path d="M9.8 2.6c1.5 0 1.4 1.5 1.4 2.6 0 1 .3 1.6 1.3 2.1v1.4c-1 .5-1.3 1.1-1.3 2.1 0 1.1.1 2.6-1.4 2.6" />
        </>
      );
    // Markup / stylesheet: the hash.
    case 'markup':
      return (
        <>
          <path d="M6.6 2.8 5 13.2M11 2.8 9.4 13.2" />
          <path d="M2.6 6.1h10.8M2 9.9h10.8" />
        </>
      );
    // Media: a frame with a horizon and a sun.
    case 'image':
      return (
        <>
          <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.8" />
          <circle cx="5.7" cy="6.4" r="1.1" />
          <path d="M3 11.4 6.4 8.3l2.2 2 1.7-1.5L13 11.2" />
        </>
      );
    // Archives: a crate with its seam.
    case 'archive':
      return (
        <>
          <rect x="2.2" y="4.4" width="11.6" height="8.4" rx="1.4" />
          <path d="M2.2 7h11.6M8 7v5.8" />
        </>
      );
    // Everything else: the plain document (the harness's own file outline).
    case 'document':
      return (
        <>
          <path d="M4.3 2.6h4.1l3.3 3.3v7.5H4.3z" />
          <path d="M8.4 2.8v3.2h3.1" />
        </>
      );
  }
}
