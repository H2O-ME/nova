/**
 * The standard action button: one geometry, three intents. Dialog footers and
 * card actions share the shape — a 32px row, the app's hairline border, the
 * ink fill marking the recommended verb — and `variant` carries the intent so
 * callers never hand-tune a one-off button.
 */
import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../composer/cx.js';
import css from './Button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The intent: `secondary` (bordered), `primary` (ink fill), or the outlined danger. */
  variant?: 'secondary' | 'primary' | 'dangerOutline';
}

/** Render the standard button. */
export function Button({ variant = 'secondary', className, type, ...rest }: ButtonProps): JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      className={cx(css.button, css[variant], className)}
      {...rest}
    />
  );
}
