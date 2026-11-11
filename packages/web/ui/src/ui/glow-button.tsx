/**
 * GlowButton — the accent-filled control with a lifted, lit interior.
 *
 * The catalogue's `hover-border-gradient` button, reduced to what actually
 * carries the effect: the accent RAMP as fill, a 1px inner top highlight, and a
 * bloom that grows on hover. Two details are load-bearing:
 *
 *  1. **Hover uses `filter`, not `background-color`.** With a gradient fill the
 *     `background-image` layer paints over `background-color`, so a
 *     colour-swap hover moves no pixels at all — that rule is silently dead.
 *     `filter: brightness()` is compositor-only and works on the image layer.
 *  2. **`disabled` must not brighten.** `:hover` still matches a disabled
 *     button in some browsers, so the hover rule is gated on `:not(:disabled)`.
 *
 * Variants:
 *  - `accent` — the primary action (send, confirm).
 *  - `ghost`  — a quiet control on a raised surface.
 *  - `outline` — a bordered control for secondary actions.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.js';

export type GlowButtonVariant = 'accent' | 'ghost' | 'outline';

export interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: GlowButtonVariant;
  /** Circle button: 34px, for icon-only actions like send. */
  round?: boolean;
}

const VARIANT: Record<GlowButtonVariant, string> = {
  accent: [
    'text-ink-inverse',
    // The ramp, not a flat fill: this is the one control that should read as
    // lit from the upper-left.
    'bg-brand [background-image:var(--nova-color-accent-gradient)]',
    '[box-shadow:var(--nova-glow-inner-highlight),var(--nova-glow-interactive)]',
    'hover:brightness-110',
  ].join(' '),
  ghost: [
    'text-ink-secondary bg-transparent',
    'hover:bg-[var(--nova-interactive-hover)] hover:text-ink-primary',
  ].join(' '),
  outline: [
    'text-ink-primary bg-transparent',
    'border border-border-strong',
    'hover:bg-[var(--nova-interactive-hover)]',
  ].join(' '),
};

export function GlowButton({
  children,
  className,
  variant = 'ghost',
  round = false,
  disabled,
  ...rest
}: GlowButtonProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2',
        'transition-[filter,background-color,box-shadow] duration-base ease-out-nova',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        round ? 'size-[34px] rounded-full' : 'h-8 rounded-lg px-3 text-[13px]',
        VARIANT[variant],
        // The dark glyph on an accent fill: the ramp is bright enough that
        // `text-ink-inverse` (near-white) would wash out at the light end.
        variant === 'accent' && 'text-surface-base',
        // A gradient fill cannot be brightened when there is nothing to do.
        variant === 'accent' && 'disabled:opacity-40 disabled:hover:brightness-100',
        disabled && 'cursor-default',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
