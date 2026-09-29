/**
 * Ported from deepseek-harness ui-primitives `StateDot.tsx` (MIT) — the leading
 * run-state mark a tool row and a terminal card share, so the two never disagree
 * about whether something is still running.
 *
 * Two visual families, exactly as the reference draws them:
 *  - **solid states** (`done` / `warning` / `error` / `idle`) keep the 10px
 *    layout slot and paint one 6px currentColor core inside it;
 *  - **ongoing** is not a dot at all: it is a 14px ring whose arc breathes and
 *    whose whole glyph rotates continuously (both keyframes share one 1.5s
 *    period so pinning their start times aligns them).
 *
 * The animations are pinned to document time zero: a CSS animation starts when
 * its element is inserted, so loaders mounted at different moments would rotate
 * out of phase. One shared start time keeps every visible loader in step.
 */
import css from './StateDot.module.css';

/**
 * State semantic: green done / amber user-attention / tertiary-grey loading /
 * red error / neutral-grey idle for a tracked subject with nothing in progress.
 */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle';

/**
 * Pin the loader's CSS animations to document time zero.
 * @param element - the mounted loader, or null on unmount.
 */
function syncSpinner(element: SVGSVGElement | null): void {
  if (element === null) return;
  // jsdom (the unit lane) implements no Web Animations despite lib.dom's
  // non-optional typing; the optional call leaves that lane unsynced.
  const spinner = element as { getAnimations?: SVGSVGElement['getAnimations'] };
  for (const animation of spinner.getAnimations?.({ subtree: true }) ?? []) animation.startTime = 0;
}

/**
 * Render a state dot.
 * @param props.state - which of `done`, `warning`, `ongoing`, `error`, or `idle` to show.
 * @param props.size - outer diameter in px; defaults to 14 for ongoing and 10 for solid states.
 * @param props.className - extra class for layout placement.
 * @param props.appearance - compact dot by default; step uses a filled check or hollow pending circle.
 * @returns the dot element (aria-hidden; pair with text for accessibility).
 */
export function StateDot({ state, size, className, appearance = 'dot' }: {
  state: StateDotState;
  size?: number | undefined;
  className?: string | undefined;
  appearance?: 'dot' | 'step';
}): JSX.Element {
  const edge = size ?? (state === 'ongoing' ? 14 : 10);
  if (state === 'ongoing') {
    return (
      <svg
        ref={syncSpinner}
        className={className === undefined ? css.spinner : `${css.spinner} ${className}`}
        data-state="ongoing"
        width={edge}
        height={edge}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <g className={css.spinnerMotion}>
          <circle className={css.spinnerTrack} cx="12" cy="12" r="9.5" />
          <circle className={css.spinnerArc} cx="12" cy="12" r="9.5" />
        </g>
      </svg>
    );
  }
  return (
    <span
      className={className === undefined
        ? (appearance === 'step' ? css.step : css.dot)
        : `${appearance === 'step' ? css.step : css.dot} ${className}`}
      data-state={state}
      style={{ width: edge, height: edge }}
      aria-hidden="true"
    >
      {appearance === 'step' && state === 'done' && <StepCheckGlyph size={edge - 2} />}
    </span>
  );
}

/** The filled step marker's tick: a bare stroke path in the step's own foreground. */
function StepCheckGlyph({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.25 7.5 5.9 10.1l4.85-6.2" />
    </svg>
  );
}
