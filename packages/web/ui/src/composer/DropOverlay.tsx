/**
 * The full-viewport invitation shown while a file drag is over the page,
 * ported from deepseek-harness `ui-attachment/src/DropOverlay.tsx` +
 * `DropOverlay.module.css` (c) 2026 DeepSeek — MIT License.
 *
 * Decoration only: `pointer-events: none` keeps drag targeting on the page
 * below, so the document-level listeners keep an accurate enter/leave count and
 * own accept/reject. Rendered as the body's last layer (a portal) for the same
 * reason as the reference: a transformed ancestor would otherwise shrink the
 * fixed mask.
 *
 * Not ported: the reference's two illustrations (its own brand artwork). Ours
 * is the product's upload mark, drawn here in the same 115 × 84 seat.
 */
import { createPortal } from 'react-dom';
import css from './DropOverlay.module.css';

/** The two lines the overlay can carry, resolved by its owner. */
export interface DropOverlayLabels {
  /** The headline: the invitation, or why the drop will be refused. */
  title: string;
  /** The limits line; shown only while drops are accepted. */
  desc?: string | undefined;
}

/**
 * Render the drop layer.
 * @param props.disabled - drops are currently refused: the mark greys out and
 *   the limits line is dropped (a limit the reader cannot reach is noise).
 * @param props.labels - resolved title and limits strings.
 * @returns the overlay layer.
 */
export function DropOverlay({ disabled, labels }: {
  disabled: boolean;
  labels: DropOverlayLabels;
}): JSX.Element {
  return createPortal(
    <div className={css.mask} role="status">
      <div className={css.wrap}>
        <div className={disabled ? `${css.illustration} ${css.illustrationDisabled}` : css.illustration} aria-hidden="true">
          <svg width="115" height="84" viewBox="0 0 115 84" fill="none" aria-hidden="true">
            {/* Two stacked cards behind, the live one in front: a drop lands ON
                something, and the offset pair says so at a glance. */}
            <rect x="16" y="14" width="46" height="58" rx="10" className={css.cardBack} transform="rotate(-9 16 14)" />
            <rect x="55" y="12" width="46" height="58" rx="10" className={css.cardBack} transform="rotate(8 55 12)" />
            <rect x="34" y="10" width="50" height="64" rx="12" className={css.cardFront} />
            <path d="M59 50V26" className={css.arrow} strokeWidth="3.5" strokeLinecap="round" />
            <path d="M48 36L59 25L70 36" className={css.arrow} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className={css.title}>{labels.title}</div>
        {!disabled && labels.desc !== undefined && <div className={css.desc}>{labels.desc}</div>}
      </div>
    </div>,
    document.body,
  );
}
