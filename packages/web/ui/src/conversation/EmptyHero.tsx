/**
 * The blank-column hero chrome, ported from deepseek-harness `ui-conversation`
 * EmptyHero.tsx / HeroShell.module.css (c) 2026 DeepSeek — MIT License: the
 * mark + headline lockup (34px mark leading a 26/32 headline, gap 10) with the
 * superscript preview badge, centered above the composer card.
 *
 * Differences from the source, both deliberate: the workspace chip and the
 * agent-preset seat are not ported (this surface has no workspace selector, so
 * a chip would be a dead control), and the whale itself is not ported — the
 * mark is our own artwork (the harness's fish is its own brand, and its SMIL
 * path morph only makes sense for that geometry; the CSS sway it rides is
 * ported verbatim, keyframes name included so a future sync reads cleanly).
 */
import type { ReactNode } from 'react';
import css from './HeroShell.module.css';

/** Native viewBox of the hero mark (width and height in user units). */
const MARK_VIEWBOX = { width: 32, height: 24 };

/**
 * The hero mark: a four-point star, the brand glyph of the product the column
 * belongs to. Decorative — hidden from the accessibility tree; the headline
 * beside it carries the words.
 * @returns the mark svg element.
 */
function HeroMark(): JSX.Element {
  return (
    <svg
      className={css.fish}
      width={34}
      height={(34 * MARK_VIEWBOX.height) / MARK_VIEWBOX.width}
      viewBox={`0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d="M16 0 Q18 10 32 12 Q18 14 16 24 Q14 14 0 12 Q14 10 16 0 Z" fill="currentColor" />
    </svg>
  );
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** Authorized renderer for the hero brand-mark slot (defaults to our mark). */
  mark?: ReactNode;
}

/**
 * Render the hero chrome (headline only; no composer, no workspace row).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ mark }: HeroShellProps): JSX.Element {
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.headline}>
          {/* figma 34:10412: fish 34×25 leading the headline, gap 10. */}
          <span className={css.fishHitbox}>{mark ?? <HeroMark />}</span>
          <span className={css.titleGroup}>
            {/* Own element: keeps the headline text addressable apart from the badge. */}
            <span>Nova</span>
            <span className={css.previewBadge}>预览版</span>
          </span>
        </div>
        <div className={css.body}>
          {/* The composer remains mounted outside this component. */}
        </div>
      </div>
    </div>
  );
}