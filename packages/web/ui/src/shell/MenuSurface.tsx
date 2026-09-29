/**
 * The one menu material every dropdown on this surface wears, ported from
 * deepseek-harness `ui-primitives/MenuSurface.tsx` + `MenuSurface.module.css`
 * (c) 2026 DeepSeek — MIT License.
 *
 * Why the material is a layer and not a `background` on the card: the fill is
 * translucent (`--dsw-menu-surface-fill`, 58% light / 45% dark) and carries
 * `backdrop-filter: var(--dsw-menu-backdrop-filter)`. Declaring the filter on
 * the card itself would make the card a backdrop root and a containing block
 * for `position: fixed` descendants, so it lives on an absolutely positioned
 * child painted behind the content (`z-index: -1` under `isolation: isolate`)
 * and the card keeps only geometry, elevation and ink.
 *
 * One reduction of the source: no macOS opaque backing (`data-menu-backing`).
 * That backing exists so Chromium can blur the page over native window
 * vibrancy; a browser tab has none, and the CSS anchors that aligned it go
 * with it.
 *
 * The theme still owns the fill and the filter: no component sheet redeclares
 * either token, so a rebind of `--dsw-menu-surface-fill` or
 * `--dsw-menu-backdrop-filter` reaches every menu at once.
 */
import { forwardRef } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import css from './MenuSurface.module.css';

export interface MenuSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** The card's own geometry (radius, padding, placement). */
  className?: string | undefined;
  /** Inline placement supplied by the caller's positioning hook. */
  style?: CSSProperties | undefined;
  children: ReactNode;
}

/**
 * Paint the shared menu material behind arbitrary menu content.
 * @param props - see MenuSurfaceProps.
 * @param ref - the card element (the material layer is not part of it).
 * @returns the card with its material layer.
 */
export const MenuSurface = forwardRef<HTMLDivElement, MenuSurfaceProps>(function MenuSurface(
  { className, style, children, ...rest },
  ref,
) {
  return (
    <div
      {...rest}
      ref={ref}
      data-menu-material="translucent"
      className={className === undefined ? css.surface : `${css.surface} ${className}`}
      style={style}
    >
      <div aria-hidden="true" className={css.material} />
      {children}
    </div>
  );
});
