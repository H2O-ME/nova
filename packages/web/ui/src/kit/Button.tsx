/**
 * The standard action button: one geometry, three intents. Dialog footers and
 * card actions share the shape — a 32px row, the app's hairline border, the
 * ink fill marking the recommended verb — and `variant` carries the intent so
 * callers never hand-tune a one-off button.
 *
 * The element is shadcn's `Button` (ghost, sm): one button implementation for
 * the whole app, so focus-ring, disabled and pressed semantics come from the
 * library. This module's sheet still owns the kit geometry (32px, hairline,
 * ink fill) — unlayered module rules outrank the utility classes, so the look
 * is unchanged while the semantics stop being hand-rolled.
 */
import type { ButtonHTMLAttributes } from 'react';
import { Button as LibraryButton } from '../components/ui/button.js';
import { cx } from '../composer/cx.js';
import css from './Button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The intent: `secondary` (bordered), `primary` (ink fill), or the outlined danger. */
  variant?: 'secondary' | 'primary' | 'dangerOutline';
}

/** Render the standard button. */
export function Button({ variant = 'secondary', className, type, ...rest }: ButtonProps): JSX.Element {
  return (
    <LibraryButton
      type={type ?? 'button'}
      variant="ghost"
      size="sm"
      className={cx(css.button, css[variant], className)}
      {...rest}
    />
  );
}
