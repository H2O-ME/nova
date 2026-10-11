/**
 * The standard icon-only button: 28px (`md`) or 24px (`sm`), borderless,
 * hover-filled, one inset focus ring. Five recipes used to live across the app
 * (the right panel's, the header's, and three circle one-offs); this is the one
 * that survived — the right panel's native scale, because it was the only recipe
 * with a variant story (active/danger) and the widest use.
 *
 * Shape is the radius ladder's own rule: an icon button is a square control, so
 * it takes `--nova-radius-sm`; `--nova-radius-full` is for shapes that are
 * circles by nature (status dots, avatars), not for controls. Diffs from the
 * retired recipes, named: the circle recipes (goal row, approval/question
 * pager) become 4px squares; the header's 4px literal becomes the same token;
 * the goal row's 14px glyph becomes the md 15px one.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../composer/cx.js';
import css from './IconButton.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The accessible name; also the tooltip (the reference's own rule for rows). */
  label: string;
  children: ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean;
  /** A persistent on-state (`iconButtonActive`). */
  active?: boolean;
  /** A destructive verb (`iconButtonDanger`) — still needs its own confirm. */
  danger?: boolean;
  size?: 'md' | 'sm';
}

/** Render the standard icon button. */
export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
  danger = false,
  size = 'md',
  type,
  className,
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      className={cx(css.iconButton, size === 'sm' && css.iconButtonSm, active && css.iconButtonActive, danger && css.iconButtonDanger, className)}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
