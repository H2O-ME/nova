/**
 * Text-only activity animation with a stable span across lifecycle changes.
 *
 * This is the harness's ONE running-text treatment: a gradient painted through
 * the glyphs (`background-clip: text`) whose highlight sweeps a 4s linear cycle
 * — the reference's `.animated-gradient-text` parameters, see the sheet. Rows
 * do not fake it with an overlay: the text node itself is the animation, so the
 * words stay legible at every frame and the span survives the running→settled
 * transition without remounting (the attribute flips, the node stays).
 *
 * The gradient is percentage-based (300% background), so a long line and a short
 * one sweep at the same rate without measuring the text: the reference derives
 * nothing from length either.
 */
import { memo } from 'react';
import css from './TextShimmer.module.css';

export interface TextShimmerProps {
  /** The text to paint. */
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
  return (
    <span
      className={className === undefined ? css.root : `${css.root} ${className}`}
      data-text-shimmer={active || undefined}
    >
      {children}
    </span>
  );
});
