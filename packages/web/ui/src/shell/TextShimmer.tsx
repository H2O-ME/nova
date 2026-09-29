/**
 * Text-only activity animation with a stable span across lifecycle changes —
 * port of the harness `ui-primitives/src/TextShimmer.tsx` (c) 2026 DeepSeek —
 * MIT License.
 *
 * This is the harness's ONE running-text treatment: a gradient painted through
 * the glyphs (`background-clip: text`) whose highlight sweeps on a 1.5s cycle.
 * Rows do not fake it with an overlay: the text node itself is the animation,
 * so the words stay legible at every frame and the span survives the
 * running→settled transition without remounting (the attribute flips, the node
 * stays).
 *
 * The spread is derived from the text length so a long line sweeps at the same
 * apparent speed as a short one; the harness recomputes it only when the length
 * changes, which is why this uses `useMemo` on `children.length` rather than
 * the text itself.
 */
import { memo, useMemo } from 'react';
import type { CSSProperties } from 'react';
import css from './TextShimmer.module.css';

export interface TextShimmerProps {
  /** The text to paint; a string so the spread can be measured from it. */
  children: string;
  /** Whether the owning operation is still running. */
  active: boolean;
  /** Owner styling for placement and type. */
  className?: string | undefined;
}

/**
 * Render text with an optional moving highlight; inactive text keeps the same node.
 * @param props - localized text, running state, and owner styling.
 * @returns the retained text span.
 */
export const TextShimmer = memo(function TextShimmer({ children, active, className }: TextShimmerProps): JSX.Element {
  const style = useMemo(
    () => ({ '--dsh-text-shimmer-spread': `${children.length * 8}px` }) as CSSProperties,
    [children.length],
  );
  return (
    <span
      className={className === undefined ? css.root : `${css.root} ${className}`}
      style={style}
      data-text-shimmer={active || undefined}
    >
      {children}
    </span>
  );
});
