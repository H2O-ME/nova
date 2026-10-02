/**
 * The right panel's own glyphs: tab marks, row affordances, page verbs.
 *
 * Hand-written inline SVG, `stroke: currentColor`, design box on the element
 * itself (`width`/`height` attributes) — an SVG carrying only a `viewBox` has no
 * intrinsic size and collapses to nothing in a flex row, which the surface's
 * style guard pins for every file. The shared chrome glyphs live in
 * `../icons.js`; these are the ones only a sidebar draws, kept here so the
 * panel's iconography is one file instead of scattered JSX.
 */
type P = { className?: string };

/** The start page's compass (the reference's `CompassGlyph`): ring + needle rhombus. */
export const CompassGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M10.61 5.39 8.99 8.99 5.39 10.61 7.01 7.01Z" fill="currentColor" stroke="none" />
  </Svg>
);

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

/** 变更: a file with a diff marr on its edge. */
export const DiffTabIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M4 2.75h5.5L13 6.25v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.25v-9A1.5 1.5 0 0 1 4.5 2.75Z" />
    <path d="M6.5 9.5h3" />
    <path d="M8 8v3" />
  </Svg>
);

/** 文件: a folder. */
export const FilesTabIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2.75 5.25v6.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.75 5.25H8L6.5 3.25H4.25a1.5 1.5 0 0 0-1.5 1.5Z" />
  </Svg>
);

/** 任务: a checklist. */
export const TasksTabIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M6.5 4.75h6.75" />
    <path d="M6.5 8h6.75" />
    <path d="M6.5 11.25h6.75" />
    <path d="M2.75 4.5l1.25 1.25L6 3.75" />
    <path d="M2.75 9.75l1.25 1.25 2-2" />
  </Svg>
);

/** 终端: a prompt frame with a cursor bar. */
export const TerminalTabIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
    <path d="M4.5 6.5l2 2-2 2" />
    <path d="M8.5 10.5h3" />
  </Svg>
);

/** Refresh: a circular arrow (the shared chrome set has one; this is the 14px row mark). */
export const RefreshGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13 2.75V5.5h-2.75" />
  </Svg>
);

/** Stage: a plus in a box. */
export const StageGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2" />
    <path d="M8 5.75v4.5M5.75 8h4.5" />
  </Svg>
);

/** Unstage: a minus in a box. */
export const UnstageGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2" />
    <path d="M5.75 8h4.5" />
  </Svg>
);

/** Save: a downward arrow into a tray. */
export const SaveGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 2.75v7" />
    <path d="M5.25 7.25 8 10l2.75-2.75" />
    <path d="M3 12.25h10" />
  </Svg>
);

/** Preview: an eye. */
export const PreviewGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M1.75 8S4 4.25 8 4.25 14.25 8 14.25 8 12 11.75 8 11.75 1.75 8 1.75 8Z" />
    <circle cx="8" cy="8" r="1.75" />
  </Svg>
);

/** Edit: a pencil. */
export const EditGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M11.25 2.75l2 2-7.5 7.5-2.75.75.75-2.75 7.5-7.5Z" />
  </Svg>
);

/** Run: a play triangle. */
export const RunGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M4.5 3.25v9.5l8-4.75-8-4.75Z" />
  </Svg>
);

/** Stop: a square. */
export const StopGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1.5" />
  </Svg>
);

/** Chevron for tree disclosure (`data-open` rotates it in the sheet). */
export const ChevronGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M6.25 3.75 10.5 8l-4.25 4.25" />
  </Svg>
);

/** A row's verbs ("more"): three dots. */
export const MoreGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

/** Reveal: a directory opened (the dock's own toggle). */
export const TreeDockGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2 12.25V3.75h4l1.5 1.75h4.5v1.75" />
    <path d="M2 12.25l2-4.25h10l-2 4.25H2Z" />
  </Svg>
);

/** 并排: one pane split down the middle (the reference's compare-split mark). */
export const SplitGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" />
    <path d="M8 3.25v9.5" />
  </Svg>
);

/** 统一: one pane whole. */
export const UnifiedGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" />
    <path d="M4.25 6.5h7.5M4.25 9.5h7.5" />
  </Svg>
);

/** 换行: lines that turn at the edge. */
export const WrapGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2.75 4.5h10.5" />
    <path d="M2.75 8h7.5a2 2 0 1 1 0 4H7.5" />
    <path d="M9 10.5 7 12l2 1.5" />
  </Svg>
);

/** 不换行: lines that run past the edge. */
export const NoWrapGlyph = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M2.75 4.5h10.5" />
    <path d="M2.75 8h9.5" />
    <path d="M2.75 11.5h6" />
  </Svg>
);
