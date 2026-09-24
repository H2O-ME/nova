/**
 * Shared 24px disclosure chrome for compact flow rows — port of the harness
 * `ui-primitives/src/DisclosureRow.tsx`. The harness composes class names with
 * `clsx`; this build has no dependency, so the same order is produced by a
 * local `join` (first argument wins, later ones append).
 *
 * `expandOnRowClick` makes the whole title row the disclosure target (role
 * button, keyboard toggling); otherwise only the leading control expands, and
 * `previewChevron` swaps its glyph for a chevron while the row is hovered.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { ChevronDownGlyph14 } from './glyphs.js';
import css from './DisclosureRow.module.css';

export interface DisclosureRowProps {
  icon: ReactNode;
  title: string;
  open: boolean;
  expandable: boolean;
  onToggle: () => void;
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined;
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined;
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined;
  collapsedContent?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
  rowClassName?: string | undefined;
  leadingClassName?: string | undefined;
  chevronClassName?: string | undefined;
  titleClassName?: string | undefined;
}

export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  className,
  rowClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps): JSX.Element {
  const rowExpands = expandable && expandOnRowClick;
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onToggle();
  };
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onToggle();
  };
  const collapsedLeading = previewChevron
    ? (
      <>
        <span className={css.iconIdle}>{icon}</span>
        <ChevronDownGlyph14 className={join(chevronClassName, css.chevronHover)} />
      </>
    )
    : icon;
  const leading = open ? <ChevronDownGlyph14 className={chevronClassName} /> : collapsedLeading;

  return (
    <div className={join(css.root, className)} data-open={open || undefined}>
      <div
        className={join(css.row, rowClassName)}
        data-disclosure-row=""
        data-expandable={rowExpands || undefined}
        role={rowExpands ? 'button' : undefined}
        tabIndex={rowExpands ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        onClick={rowExpands ? onToggle : undefined}
        onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
      >
        {expandable && !rowExpands
          ? (
            <button
              type="button"
              className={join(css.leading, leadingClassName)}
              aria-expanded={open}
              onClick={toggleFromLeading}
            >
              {leading}
            </button>
          )
          : <span className={join(css.leading, leadingClassName)}>{leading}</span>}
        <span className={join(css.title, titleClassName)}>{title}</span>
        {(keepContentWhenOpen || !open) && collapsedContent}
      </div>
      {open && children}
    </div>
  );
}

/** `clsx`'s two-argument form: the local stand-in for the harness's dependency. */
function join(base: string | undefined, extra: string | undefined): string {
  if (base === undefined) return extra ?? '';
  return extra === undefined ? base : `${base} ${extra}`;
}