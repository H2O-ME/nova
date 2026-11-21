/**
 * The right panel's own glyphs: the 文件 tab mark and the tree's two row
 * affordances (refresh, more).
 *
 * Hand-written inline SVG, `stroke: currentColor`, design box on the element
 * itself (`width`/`height` attributes) — an SVG carrying only a `viewBox` has
 * no intrinsic size and collapses to nothing in a flex row, which the surface's
 * style guard pins for every file. The shared chrome glyphs live in
 * `../icons.js`.
 */
type P = { className?: string };

function Svg({ children, className, box = 16 }: P & { children: JSX.Element | JSX.Element[]; box?: 14 | 16 }): JSX.Element {
  return (
    <svg
      width={box}
      height={box}
      viewBox={`0 0 ${String(box)} ${String(box)}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** 文件: a folder. */
export const FilesTabIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2.75 5.25v6.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.75 5.25H8L6.5 3.25H4.25a1.5 1.5 0 0 0-1.5 1.5Z" />
  </Svg>
);

/** Refresh: an open circular arrow. */
export const RefreshGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13 2.75V5.5h-2.75" />
  </Svg>
);

/** More: three dots. */
export const MoreGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);
