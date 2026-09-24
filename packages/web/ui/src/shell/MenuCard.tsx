/**
 * The one menu card, as a component: the portaled surface plus the three row
 * shapes every menu on this surface uses (a titled section, a radio option with
 * its trailing check, a status or error line).
 *
 * It exists because three callers build the same card — the composer's model
 * seat, the sidebar's view options, the sidebar's settings — and the sheet that
 * dresses them (`MenuCard.module.css`, ported from deepseek-harness
 * `ui-model-selection` + `ui-primitives` Menu, MIT) belongs to exactly one of
 * them. Markup lives here too, so a menu that grows a row shape grows it once.
 *
 * Placement is NOT here: the caller owns where the card goes (this surface uses
 * `shell/anchored-popover.ts` for the portaled cards), and passes the ref and
 * inline style in.
 */
import type { CSSProperties, MutableRefObject, ReactNode } from 'react';
import { CheckIcon } from '../icons.js';
import css from './MenuCard.module.css';

export interface MenuCardProps {
  /** The card's accessible name (`role=menu`'s label). */
  label: string;
  /** A row is being fetched: the card reports it as busy. */
  busy?: boolean | undefined;
  cardRef?: MutableRefObject<HTMLDivElement | null> | undefined;
  style?: CSSProperties | undefined;
  /** Marker attributes a caller's tests or scripts read (`data-model-menu`). */
  data?: Record<string, string> | undefined;
  children: ReactNode;
}

/**
 * Render the card.
 * @param props - see MenuCardProps.
 * @returns the menu card element.
 */
export function MenuCard({ label, busy, cardRef, style, data, children }: MenuCardProps): JSX.Element {
  return (
    <div
      ref={cardRef}
      className={css.card}
      style={style}
      role="menu"
      aria-label={label}
      aria-busy={busy}
      {...data}
    >
      <div className={css.groups}>{children}</div>
    </div>
  );
}

/** A titled group of rows (the reference's `Menu` section). */
export function MenuGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section role="group" aria-label={title} className={css.group}>
      <div className={css.groupTitle}>{title}</div>
      {children}
    </section>
  );
}

export interface MenuOptionProps {
  /** The row's one-line label. */
  label: string;
  /** A secondary line under it (a model row's id, say). */
  hint?: string | undefined;
  /** Which option a radio group is on (renders the trailing check). */
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Native tooltip (a raw id, when the label is a display name). */
  title?: string | undefined;
  /** `menuitemradio` for a choice, `menuitem` for an action. */
  role?: 'menuitemradio' | 'menuitem' | undefined;
  /** The row element, for a menu that walks its rows with the arrow keys. */
  buttonRef?: ((node: HTMLButtonElement | null) => void) | undefined;
  onClick: () => void;
}

/**
 * Render one option row.
 * @param props - see MenuOptionProps.
 * @returns the option button.
 */
export function MenuOption({
  label,
  hint,
  selected = false,
  disabled = false,
  title,
  role = 'menuitemradio',
  buttonRef,
  onClick,
}: MenuOptionProps): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      role={role}
      aria-checked={role === 'menuitemradio' ? selected : undefined}
      className={css.option}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className={css.optionCopy}>
        <span className={css.optionLabel}>{label}</span>
        {hint !== undefined && <span className={css.optionHint}>{hint}</span>}
      </span>
      <span className={css.check}>{selected ? <CheckIcon /> : null}</span>
    </button>
  );
}

/** The card's own reading while it is empty or loading (the reference's rows). */
export function MenuStatus({ children }: { children: ReactNode }): JSX.Element {
  return <div className={css.status}>{children}</div>;
}

/** The card's empty state, after a load that answered with nothing. */
export function MenuEmpty({ children }: { children: ReactNode }): JSX.Element {
  return <div className={css.empty}>{children}</div>;
}

/** A failure strip with its one action (retry). */
export function MenuError({ message, retryLabel, onRetry }: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div className={css.error}>
      <span>{message}</span>
      <button type="button" className={css.retry} onClick={onRetry}>{retryLabel}</button>
    </div>
  );
}