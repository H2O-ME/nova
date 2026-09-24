/**
 * Icon set: hand-written inline SVGs, stroke = currentColor, sized by CSS
 * (the harness discipline — no per-callsite size props, no Unicode glyphs).
 *
 * The design box also rides the element as `width`/`height` **attributes**: CSS
 * still wins wherever a call site scales an icon down (`.triggerIcon svg`
 * 14px, `.inspectButton svg` 12px), but an icon whose context forgets a rule
 * keeps its box instead of collapsing to nothing. An SVG with only a viewBox
 * has no intrinsic size, so that is exactly what it did — a 44px pill whose
 * two-character label wrapped vertically, and chevrons rendered at 0×0. This
 * is the harness's own pattern (`IconXxx16` components emit `width={size}`);
 * the attribute is the floor, the sheet is the exception.
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

export const PanelIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
    <path d="M6.25 2.75v10.5" />
  </Svg>
);

export const PlusIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </Svg>
);

export const SunIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.15 1.15M11.45 11.45l1.15 1.15M12.6 3.4l-1.15 1.15M4.55 11.45L3.4 12.6" />
  </Svg>
);

export const MoonIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M13.5 9.5A5.75 5.75 0 0 1 6.5 2.5a5.75 5.75 0 1 0 7 7Z" />
  </Svg>
);

export const RefreshIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M13.25 8a5.25 5.25 0 1 1-1.55-3.72" />
    <path d="M13.25 1.75v3h-3" />
  </Svg>
);

export const ArrowDownIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 3v10M4.25 9.25 8 13l3.75-3.75" />
  </Svg>
);

export const CloseIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

/** The sidebar's session search (`IconSearchOutline16`'s shape, own stroke). */
export const SearchIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.75" />
    <path d="M10.5 10.5 14 14" />
  </Svg>
);

/** The view-options trigger (`IconPersonalizationOutline16`'s sliders). */
export const SlidersIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M3 4.75h3.05M8.35 4.75h4.65M3 11.25h4.65M9.95 11.25h3.05" />
    <circle cx="7.45" cy="4.75" r="1.35" />
    <circle cx="9.05" cy="11.25" r="1.35" />
  </Svg>
);

/** The sidebar's settings seat (`IconSettingsOutline16`'s cog, own stroke). */
export const SettingsIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.75" />
    <circle cx="8" cy="8" r="1.9" />
    <path d="M8 1.6v1.65M8 12.75v1.65M1.6 8h1.65M12.75 8h1.65M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2" />
  </Svg>
);

export const ChevronDownIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);

export const ChevronLeftIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M10 4 6 8l4 4" />
  </Svg>
);

export const ChevronRightIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
);

export const SendIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 13V3.5M4 7.5 8 3.5l4 4" />
  </Svg>
);

export const StopIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const CheckIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M3 8.5l3.2 3.2L13 5" />
  </Svg>
);

export const CircleIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.5" />
  </Svg>
);

export const PlayIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M5.5 3.5l6 4.5-6 4.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const SparkleIcon = (p: P): JSX.Element => (
  <Svg {...p}>
    <path d="M8 2.5l1.4 3.6 3.6 1.4-3.6 1.4L8 12.5l-1.4-3.6L3 7.5l3.6-1.4z" fill="currentColor" stroke="none" />
    <path d="M8 6.5l.55 1.45 1.45.55-1.45.55L8 10.5l-.55-1.45L6 8.5l1.45-.55z" />
  </Svg>
);

/**
 * Filled glyphs ported from deepseek-harness ui-primitives (c) 2026 DeepSeek —
 * MIT License. The sidebar's workspace tree needs geometry the stroke set above
 * does not carry (the figma folder pair, the tree arrow, and the alert the
 * connection indicator reads with): paths are copied value-for-value, viewBox
 * and currentColor included, with the design box as the intrinsic size — CSS
 * scales them like every other icon here.
 */

/** Open folder with a 20%-opacity inner fill (ic_ds folder_open_16). */
export const FolderOpenIcon = (p: P): JSX.Element => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={p.className}>
    <path
      d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z"
      fill="currentColor"
    />
    <path
      opacity="0.2"
      d="M13.6602 7.75525C13.9618 7.7556 14.1815 8.04179 14.1045 8.33337L13.0508 12.3031C12.9304 12.7567 12.5191 13.0725 12.0498 13.0726H2.91701C2.23744 13.0725 1.7417 12.4287 1.91603 11.7719L2.77834 8.52478C2.89898 8.07146 3.31018 7.75532 3.77931 7.75525H13.6602ZM5.1963 2.95154C5.34985 2.95159 5.49377 3.02803 5.57912 3.15564L6.0508 3.86365C6.39205 4.37553 6.96685 4.68385 7.58205 4.68396H12.1699C12.7416 4.68396 13.2049 5.14754 13.2051 5.71912V6.37439H3.77931C3.02267 6.37444 2.33067 6.72671 1.88283 7.29333V3.98669C1.88299 3.4152 2.34649 2.95168 2.91798 2.95154H5.1963Z"
      fill="currentColor"
    />
  </svg>
);

/** Closed folder (ic_ds folder_close_16, figma extract). */
export const FolderClosedIcon = (p: P): JSX.Element => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={p.className}>
    <path
      transform="translate(1.5 2.429)"
      d="M5.05582 0.518756L4.50669 0.86654L5.05582 0.518756ZM13 9.4837L13.65 9.4837L13.65 3.53962L13 3.53962L12.35 3.53962L12.35 9.4837L13 9.4837ZM11.3264 1.86603L11.3264 1.21603L6.52313 1.21603L6.52313 1.86603L6.52313 2.51603L11.3264 2.51603L11.3264 1.86603ZM5.58054 1.34727L6.12968 0.999489L5.60495 0.170972L5.05582 0.518756L4.50669 0.86654L5.03141 1.69506L5.58054 1.34727ZM4.11323 1.23058e-13L4.11323 -0.65L1.67359 -0.65L1.67359 5.00699e-14L1.67359 0.65L4.11323 0.65L4.11323 1.23058e-13ZM0 1.67359L-0.65 1.67359L-0.65 9.4837L0 9.4837L0.65 9.4837L0.65 1.67359L0 1.67359ZM11.3264 11.1573L11.3264 10.5073L1.67359 10.5073L1.67359 11.1573L1.67359 11.8073L11.3264 11.8073L11.3264 11.1573ZM0 9.4837L-0.65 9.4837C-0.65 10.767 0.390308 11.8073 1.67359 11.8073L1.67359 11.1573L1.67359 10.5073C1.10828 10.5073 0.65 10.049 0.65 9.4837L0 9.4837ZM1.67359 5.00699e-14L1.67359 -0.65C0.390307 -0.65 -0.65 0.390309 -0.65 1.67359L0 1.67359L0.65 1.67359C0.65 1.10828 1.10828 0.65 1.67359 0.65L1.67359 5.00699e-14ZM5.05582 0.518756L5.60495 0.170972C5.28121 -0.340193 4.71829 -0.65 4.11323 -0.65L4.11323 1.23058e-13L4.11323 0.65C4.27282 0.65 4.4213 0.731715 4.50669 0.86654L5.05582 0.518756ZM6.52313 1.86603L6.52313 1.21603C6.36354 1.21603 6.21507 1.13431 6.12968 0.999489L5.58054 1.34727L5.03141 1.69506C5.35515 2.20622 5.91808 2.51603 6.52313 2.51603L6.52313 1.86603ZM13 3.53962L13.65 3.53962C13.65 2.25634 12.6097 1.21603 11.3264 1.21603L11.3264 1.86603L11.3264 2.51603C11.8917 2.51603 12.35 2.97431 12.35 3.53962L13 3.53962ZM13 9.4837L12.35 9.4837C12.35 10.049 11.8917 10.5073 11.3264 10.5073L11.3264 11.1573L11.3264 11.8073C12.6097 11.8073 13.65 10.767 13.65 9.4837L13 9.4837Z"
      fill="currentColor"
    />
  </svg>
);

/** Tree expand arrow: points right; consumers rotate it 90° for the open state. */
export const TriangleRightIcon = (p: P): JSX.Element => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={p.className}>
    <path
      d="M4.25 2.82782L4.25 11.1722C4.25 11.6622 4.84243 11.9076 5.18891 11.5611L9.36109 7.38891C9.57588 7.17412 9.57588 6.82588 9.36109 6.61109L5.18891 2.43891C4.84243 2.09243 4.25 2.33782 4.25 2.82782Z"
      fill="currentColor"
    />
  </svg>
);

/** Alert disc (ic_ds_warning_outline_16) for the connection indicator's states. */
export const AlertIcon = (p: P): JSX.Element => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={p.className}>
    <path d="M6.3002 3.32843L7.69986 3.32843L7.69986 7.79657H6.3002L6.3002 3.32843Z" fill="currentColor" />
    <path d="M6.3002 9.01935H7.69986V10.6711H6.3002V9.01935Z" fill="currentColor" />
    <path
      d="M12.6328 6.99976C12.6328 3.88874 10.111 1.36694 7 1.36694C3.88899 1.36695 1.3672 3.88875 1.36719 6.99976C1.36719 10.1108 3.88899 12.6326 7 12.6326C10.111 12.6326 12.6328 10.1108 12.6328 6.99976ZM13.8582 6.99976C13.8582 10.7873 10.7876 13.8579 7 13.8579C3.21244 13.8579 0.141846 10.7873 0.141846 6.99976C0.141857 3.2122 3.21245 0.141612 7 0.141602C10.7876 0.141602 13.8581 3.21219 13.8582 6.99976Z"
      fill="currentColor"
    />
  </svg>
);
