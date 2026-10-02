/**
 * The right panel's primitives: the handful of shapes its four pages share.
 *
 * Ported in shape from the reference plugin's `ui/kit.tsx` (dsh-better-sidebar,
 * MIT), because the alternative is what this panel shipped first: five icon
 * button recipes, four empty-state classes and three pill sizes, each page
 * inventing its own. One kit means the 28px control, the 22px chip, the 36px
 * header band and the three-ink-rung discipline are properties of the panel
 * rather than of whichever page a reader happens to be on.
 *
 * Two rules from the reference are carried whole:
 *   - **Loading is text, never a spinner.** {@link Notice} has no `spinner`
 *     sibling and must not grow one: a spinner says "wait" where the honest
 *     reading is usually "this directory has no answer yet".
 *   - **Selected is not hover.** A selected surface takes the active fill AND a
 *     2px inset accent bar (drawn in the row sheets, not here), so the two
 *     states cannot be confused at a glance.
 */
import type { ReactNode } from 'react';
import { cx } from '../composer/cx.js';
import css from './kit.module.css';

/** The panel's icon button: 28px (`md`) or 24px (`sm`), borderless, hover-filled. */
export interface IconButtonProps {
  /** The accessible name; also the tooltip (the reference's own rule for rows). */
  label: string;
  children: ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean;
  /** A persistent on-state (the reference's `iconButtonActive`). */
  active?: boolean;
  /** A destructive verb (`iconButtonDanger`) — still needs its own confirm. */
  danger?: boolean;
  size?: 'md' | 'sm';
  type?: 'button' | 'submit';
}

export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
  danger = false,
  size = 'md',
  type = 'button',
}: IconButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cx(css.iconButton, size === 'sm' && css.iconButtonSm, active && css.iconButtonActive, danger && css.iconButtonDanger)}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** A pill toggle: the panel's chips (lens switch, batch verbs). */
export interface ChipProps {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  selected?: boolean;
  disabled?: boolean;
}

export function Chip({ children, onClick, selected = false, disabled = false }: ChipProps): JSX.Element {
  const className = cx(css.chip, selected && css.chipSelected);
  if (onClick === undefined) return <span className={className}>{children}</span>;
  return (
    <button type="button" className={className} aria-pressed={selected} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** A group heading: a 28px band with a hairline under it and an optional action. */
export interface SectionHeaderProps {
  label: string;
  /** A count or reading riding the label's right (tabular, tertiary). */
  count?: ReactNode;
  /** An action pinned to the band's far edge (hover-revealed by the caller). */
  action?: ReactNode;
}

export function SectionHeader({ label, count, action }: SectionHeaderProps): JSX.Element {
  return (
    <div className={css.sectionHeader}>
      <span className={css.sectionLabel}>{label}</span>
      {count !== undefined && <span className={css.sectionCount}>{count}</span>}
      {action !== undefined && <span className={css.sectionAction}>{action}</span>}
    </div>
  );
}

/** A numeric badge riding a heading or a row (`16px` pill, tabular digits). */
export function CountPill({ n }: { n: number }): JSX.Element {
  return <span className={css.countPill}>{n}</span>;
}

/**
 * A text state: the panel's whole vocabulary for "nothing to draw yet".
 *
 * `kind` picks the ink and the ARIA role, never a glyph: `error` is an alert and
 * paints in the error state token, `warn` in the warning one, and everything
 * else rides the tertiary ink rung.
 */
export interface NoticeProps {
  kind?: 'empty' | 'loading' | 'error' | 'warn' | 'hint';
  children: ReactNode;
}

export function Notice({ kind = 'empty', children }: NoticeProps): JSX.Element {
  const className = cx(
    css.notice,
    kind === 'error' && css.noticeError,
    kind === 'warn' && css.noticeWarn,
    kind === 'hint' && css.noticeHint,
  );
  return (
    <p className={className} {...(kind === 'error' ? { role: 'alert' } : {})}>
      {children}
    </p>
  );
}

/** The status dot a task row carries (`ongoing` spins its ring, see the sheet). */
export function StateDot({ state }: { state: 'ongoing' | 'done' | 'error' | 'idle' }): JSX.Element {
  return <span className={css.stateDot} data-state={state} aria-hidden="true" />;
}

/**
 * The one-letter git badge (`M` / `A` / `D` / `R` / `U` / `!`).
 *
 * Monospace and 2px-radius, the reference's `StatusBadge`: a status is machine
 * text, so it reads as machine text even inside a row whose name is prose.
 */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }): JSX.Element {
  return (
    <span className={css.statusBadge} data-tone={tone}>
      {children}
    </span>
  );
}

/** The four inks a status badge or a row name may take. */
export type StatusTone = 'modified' | 'added' | 'deleted' | 'renamed' | 'neutral';
