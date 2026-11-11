/**
 * GlowCard — the gradient hairline with a lit interior.
 *
 * This is the Aceternity catalogue's signature surface (`glowing-effect` /
 * the gradient-border card): a 1px gradient ring around a dark panel, with the
 * ring brightest where the light hits. It is reproduced here with the token
 * layer's `--nova-gradient-hairline` rather than the catalogue's own hard-coded
 * white stops, so the ring inverts correctly in dark mode.
 *
 * HOW THE RING IS BUILT
 * ---------------------
 * The outer element paints the gradient as its `background` and the inner one
 * sits on top with a matching radius inset by exactly the ring width. That is
 * the only technique that produces a *gradient* border in CSS — `border-image`
 * cannot follow a border-radius, and a real `border` can only take one colour.
 *
 * The inner radius is `calc(radius - ring)`; using the same radius for both
 * leaves a visible sliver of gradient at each corner where the arcs diverge.
 * The two radii are therefore derived from ONE `radius` prop rather than being
 * passed as two class names that could disagree — an earlier version took a
 * class and computed the inner radius from a hard-coded `--radius-2xl`, so any
 * caller asking for `rounded-xl` got mismatched corners.
 *
 * WHY THE INNER SURFACE IS OPAQUE
 * -------------------------------
 * A translucent interior sounds more "glassy", but it lets the ring gradient
 * show through the panel, which produces a muddy haze across the middle. The
 * glass effect is carried by `backdrop-blur` at the edges and the shadow, not
 * by interior alpha.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn.js';

/** The radius rungs this component supports, as Tailwind class + token var. */
const RADIUS = {
  lg: { className: 'rounded-lg', variable: '--radius-lg' },
  xl: { className: 'rounded-xl', variable: '--radius-xl' },
  '2xl': { className: 'rounded-2xl', variable: '--radius-2xl' },
} as const;

export type GlowCardRadius = keyof typeof RADIUS;

export interface GlowCardProps {
  children: ReactNode;
  /** Extra classes on the inner (content) surface. */
  className?: string;
  /** Extra classes on the outer ring element (positioning from the caller). */
  wrapperClassName?: string;
  /** The content surface fill; defaults to the raised plane. */
  surface?: 'raised' | 'base' | 'panel';
  /** Ring width in px. 1 is the catalogue's value; thicker reads as a frame. */
  ring?: number;
  /** Corner rung. Drives BOTH layers so they cannot disagree. */
  radius?: GlowCardRadius;
}

const SURFACE: Record<NonNullable<GlowCardProps['surface']>, string> = {
  raised: 'bg-surface-raised',
  base: 'bg-surface-base',
  panel: 'bg-surface-panel',
};

export function GlowCard({
  children,
  className,
  wrapperClassName,
  surface = 'raised',
  ring = 1,
  radius = '2xl',
}: GlowCardProps): JSX.Element {
  const rung = RADIUS[radius];
  const innerStyle: CSSProperties = {
    // One rung, two computed radii: the inner arc must shrink by the ring width
    // or the two arcs diverge at the corners.
    borderRadius: `calc(var(${rung.variable}) - ${ring}px)`,
  };
  return (
    <div
      className={cn('p-px', rung.className, wrapperClassName)}
      style={{ backgroundImage: 'var(--nova-gradient-hairline)' }}
    >
      <div
        className={cn(
          'h-full w-full backdrop-blur-xl',
          rung.className,
          SURFACE[surface],
          className
        )}
        style={innerStyle}
      >
        {children}
      </div>
    </div>
  );
}
