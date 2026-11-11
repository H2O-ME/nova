/**
 * AuroraBackground — the wash of coloured light behind an empty state.
 *
 * Straight from the Aceternity catalogue's `aurora-background`, rewritten to
 * paint with Nova's glow tokens instead of hard-coded hues so it follows the
 * theme (`--nova-glow-wash` shifts in dark mode).
 *
 * Three layers, in order of how much they should be seen:
 *
 *  1. **The bloom** — one dominant accent radial. An even three-way split
 *     reads as grey haze rather than as light; the other two are supporting
 *     tints that only add a little chromatic drift.
 *  2. **The grid** — hairlines masked to a vignette, kept away from the centre
 *     column. Behind running text they read as smudged glass.
 *  3. **Both are `aria-hidden` and `pointer-events-none`** — this is scenery,
 *     never a hit target, and it must not be announced to a screen reader.
 *
 * The component is `absolute inset-0` by contract: the caller owns the box it
 * fills (the hero region), because only the caller knows what "the empty state
 * area" means in its own layout.
 */
import type { ReactNode } from 'react';
import { cn } from './cn.js';

export interface AuroraBackgroundProps {
  /** The content the scenery sits behind. */
  children?: ReactNode;
  /**
   * Position/stacking classes from the caller. The component deliberately does
   * NOT declare `relative isolate` itself: callers mount it either as a
   * full-bleed absolute layer over a seat, or as a wrapper around content, and
   * `isolate` in particular would create a stacking context that changes the
   * containing block of any absolutely-positioned child the caller's own
   * subtree relies on. Positioning is the caller's decision.
   */
  className?: string;
  /** The grid is opt-out: a very dense surface looks worse with it. */
  grid?: boolean;
}

export function AuroraBackground({
  children,
  className,
  grid = true,
}: AuroraBackgroundProps): JSX.Element {
  return (
    <div aria-hidden={children === undefined ? 'true' : undefined} className={cn('ui-root', className)}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* The bloom. A single wide radial plus two faint tints. */}
        <div
          className="absolute inset-0"
          style={{ background: 'var(--nova-aurora-wash)' }}
        />
        {/* The grid, in its own layer so either can be retuned alone. */}
        {grid ? (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'var(--nova-grid-lines)',
              backgroundSize: '44px 44px',
              maskImage:
                'radial-gradient(ellipse 58% 50% at 50% 34%, var(--nova-mask-drop) 34%, var(--nova-mask-keep) 100%)',
              WebkitMaskImage:
                'radial-gradient(ellipse 58% 50% at 50% 34%, var(--nova-mask-drop) 34%, var(--nova-mask-keep) 100%)',
            }}
          />
        ) : null}
      </div>
      {children}
    </div>
  );
}
