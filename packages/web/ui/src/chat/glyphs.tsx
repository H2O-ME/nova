/**
 * Glyphs the ported chat chrome needs. Hand-written inline SVGs in this
 * repo's icon language (16/14 boxes, currentColor, stroke based, sized by
 * CSS) — the harness draws the same slots with its own filled artwork
 * (`ui-primitives/src/icons/index.tsx`, `LinkIcon.tsx`); the ported sheets keep
 * the harness's sizing/positioning rules for them (`.action svg`,
 * `.leading svg`, `.linkIcon`).
 */
type P = { className?: string };

function Svg({ children, className, box }: P & { children: JSX.Element | JSX.Element[]; box: 14 | 16 }): JSX.Element {
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

/** The link-category glyph (`url` kind): a globe, riding the anchor's color. */
export const UrlGlyph = (p: P): JSX.Element => (
  <Svg {...p} box={16}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M1.9 8h12.2" />
    <path d="M8 1.75c1.7 1.9 2.6 3.9 2.6 6.25S9.7 14.25 8 14.25 5.4 12.35 5.4 8 6.3 3.65 8 1.75Z" />
  </Svg>
);

export const CopyGlyph = (p: P): JSX.Element => (
  <Svg {...p} box={16}>
    <rect x="2.25" y="5.25" width="8.5" height="8.5" rx="2" />
    <path d="M5.75 5.25V4a1.75 1.75 0 0 1 1.75-1.75h4.5A1.75 1.75 0 0 1 13.75 4v4.5A1.75 1.75 0 0 1 12 10.25h-1.25" />
  </Svg>
);

export const CheckGlyph = (p: P): JSX.Element => (
  <Svg {...p} box={16}>
    <path d="M3.25 8.5l3.2 3.2 6.3-7.4" />
  </Svg>
);

/** Fork the session at this message (the harness `branch` slot). */
export const BranchGlyph = (p: P): JSX.Element => (
  <Svg {...p} box={16}>
    <circle cx="11.75" cy="3.25" r="1.75" />
    <circle cx="11.75" cy="12.75" r="1.75" />
    <path d="M3.5 2.75v7.5" />
    <path d="M3.5 6.5h3.25a3 3 0 0 1 3 3v.5" />
    <circle cx="3.5" cy="12.75" r="1.75" />
  </Svg>
);

export const ChevronDownGlyph14 = (p: P): JSX.Element => (
  <Svg {...p} box={14}>
    <path d="M3.75 5.5 7 8.75l3.25-3.25" />
  </Svg>
);

export const ChevronRightGlyph14 = (p: P): JSX.Element => (
  <Svg {...p} box={14}>
    <path d="M5.5 3.75 8.75 7 5.5 10.25" />
  </Svg>
);

/** The reasoning row's leading glyph (the harness `think` icon). */
export const ThinkGlyph14 = (p: P): JSX.Element => (
  <Svg {...p} box={14}>
    <path d="M7 1.75l1.5 3.75 3.75 1.5-3.75 1.5L7 12.25 5.5 8.5 1.75 7 5.5 5.5z" />
    <circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

/** The compaction row's leading glyph (the harness `api`/context icon). */
export const ContextGlyph14 = (p: P): JSX.Element => (
  <Svg {...p} box={14}>
    <rect x="1.75" y="2.5" width="10.5" height="9" rx="2" />
    <path d="M4.25 5.75 6 7.5 4.25 9.25" />
    <path d="M7.5 9.5h2.25" />
  </Svg>
);

/** The context-injection glyph: a box with content dropping into it. */
export const InjectionGlyph14 = (p: P): JSX.Element => (
  <Svg {...p} box={14}>
    <rect x="1.75" y="4.5" width="10.5" height="7.75" rx="2" />
    <path d="M4.5 7.5h5" />
    <path d="M4.5 9.75h3.25" />
    <path d="M7 1.25v2.5" />
    <path d="M5.75 2.5 7 3.75l1.25-1.25" />
  </Svg>
);