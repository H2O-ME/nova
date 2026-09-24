/**
 * Ported from deepseek-harness ui-primitives `StateDot.tsx` (MIT) — the leading
 * run-state mark a tool row and a terminal card share, so the two never disagree
 * about whether something is still running.
 *
 * A solid state is a colored halo (a 0.10-opacity outer layer) around a
 * 6/10-scale core; the ongoing state is an eight-cell pixel chase on the 10px
 * grid, phased by a negative per-cell delay so every cell animates from mount.
 */
import css from './StateDot.module.css';

/** State semantic: green done / amber user-attention / blue running ring / red error / grey idle. */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle';

/** Outer 3x3 matrix cells (2px pixels on a 10px grid), clockwise from top-left. */
const MATRIX_CELLS: readonly (readonly [number, number])[] = [
  [0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4],
];

/**
 * Render a state dot.
 * @param props.state - which of `done`, `warning`, `ongoing`, `error`, or `idle` to show.
 * @param props.size - outer diameter in px (default 10, the figma size).
 * @param props.className - extra class for layout placement.
 * @returns the dot element (aria-hidden; pair with text for accessibility).
 */
export function StateDot({ state, size = 10, className }: {
  state: StateDotState;
  size?: number | undefined;
  className?: string | undefined;
}): JSX.Element {
  if (state === 'ongoing') {
    return (
      <svg
        className={className === undefined ? css.matrix : `${css.matrix} ${className}`}
        data-state="ongoing"
        width={size}
        height={size}
        viewBox="0 0 10 10"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {MATRIX_CELLS.map(([x, y], index) => (
          <rect
            key={`${x}-${y}`}
            className={css.cell}
            x={x}
            y={y}
            width="2"
            height="2"
            /* Negative delay phases the chase so every cell animates from mount. */
            style={{ animationDelay: `${(index - MATRIX_CELLS.length) * 125}ms` }}
          />
        ))}
      </svg>
    );
  }
  return (
    <span
      className={className === undefined ? css.dot : `${css.dot} ${className}`}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}