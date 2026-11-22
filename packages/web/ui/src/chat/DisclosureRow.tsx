/**
 * Shared 24px disclosure chrome for compact flow rows. The harness composes
 * class names with
 * `clsx`; this build has no dependency, so the same order is produced by a
 * local `join` (first argument wins, later ones append).
 *
 * `expandOnRowClick` makes the whole title row the disclosure target (role
 * button, keyboard toggling); otherwise only the leading control expands, and
 * `previewChevron` swaps its glyph for a chevron while the row is hovered.
 *
 * The title is a {@link TextShimmer}: while the owning operation runs, the
 * highlight sweeps through the glyphs. That IS the running state — the harness
 * paints no overlay band anywhere, so no sheet here should either.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { ChevronRightGlyph14 } from './glyphs.js';
import { Button } from '../components/ui/button.js';
import { TextShimmer } from '../shell/TextShimmer.js';
import css from './DisclosureRow.module.css';

export interface DisclosureRowProps {
  icon: ReactNode;
  title: string;
  open: boolean;
  expandable: boolean;
  onToggle: () => void;
  /** Animate the title while its owning operation is running. */
  running?: boolean | undefined;
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

/** Render one disclosure header and its controlled expanded content. */
export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  running = false,
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
  // The reference keeps the row's own glyph and ADDS a chevron at the row's end
  // (`ToolSummaryRow.tsx:235-243`: `ChevronRightIcon` at `opacity-0`, revealed
  // on row hover, `rotate-90` when open). Swapping the leading glyph for a
  // chevron — what this row used to do — made the one mark that says WHAT the
  // row is disappear exactly while the reader was pointing at it (and again
  // while it was open, when the reader most needs to know what opened). The
  // leading slot is now permanent; the open/closed state lives in the trailing
  // chevron's rotation.

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
            <Button
              variant="ghost"
              size="icon-xs"
              className={join(css.leading, leadingClassName)}
              data-flow-leading=""
              aria-expanded={open}
              onClick={toggleFromLeading}
            >
              {icon}
            </Button>
          )
          : <span className={join(css.leading, leadingClassName)} data-flow-leading="">{icon}</span>}
        <TextShimmer active={running} className={join(css.title, titleClassName)}>{title}</TextShimmer>
        {(keepContentWhenOpen || !open) && collapsedContent}
        {previewChevron && (
          <ChevronRightGlyph14
            className={join(chevronClassName, css.chevronTrailing)}
            data-open={open || undefined}
            aria-hidden
          />
        )}
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
