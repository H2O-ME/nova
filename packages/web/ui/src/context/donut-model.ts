/**
 * The ring chart's geometry: the stroke-dasharray arcs `Donut.tsx` paints.
 *
 * Ported from dsh-context `components/donut.tsx` (Apache-2.0). One dasharray
 * unit is 1% of the circumference (r = 15.9155 → C ≈ 100), the `+25` offset
 * pins the first slice to 12 o'clock, and neighbouring slices give up half a
 * hairline at each end so the card's own background parts their colours.
 *
 * Pure and DOM-free like the rest of this directory's models, so the ring's
 * proportions are asserted directly instead of measured in a browser.
 */

/** One slice as the caller supplies it: an identity, a paint and a weight. */
export interface DonutSlice {
  key: string;
  /** A CSS colour — a `var(--dsw-*)` token in this repo, never a literal. */
  color: string;
  value: number;
}

/** One painted arc, in dasharray units over the 100-unit circumference. */
export interface DonutArc {
  key: string;
  color: string;
  /** Arc length in units (1 unit = 1% of the circumference). */
  len: number;
  /** Dash offset: where on the ring this arc starts. */
  offset: number;
}

/**
 * The hairline between two slices, in dasharray units. One unit is ≈1% of the
 * circumference ≈ 2.3px on the 96px card ring, so 0.5 reads as about a pixel.
 */
export const SEG_GAP = 0.5;

/**
 * The ring's arcs, clockwise from 12 o'clock.
 *
 * Non-finite and non-positive weights are skipped, so an all-zero (or empty)
 * ring paints nothing and the component draws its own neutral track instead of
 * a misleading "100% of nothing" pie.
 * @param slices - the weights to paint, in reading order.
 * @returns one arc per non-zero slice; empty when nothing has weight.
 */
export function donutArcs(slices: readonly DonutSlice[]): DonutArc[] {
  let total = 0;
  for (const slice of slices) {
    if (Number.isFinite(slice.value) && slice.value > 0) total += slice.value;
  }
  if (total <= 0) return [];
  const arcs: DonutArc[] = [];
  let consumed = 0;
  for (const slice of slices) {
    const value = Number.isFinite(slice.value) && slice.value > 0 ? slice.value : 0;
    if (value === 0) continue;
    const pct = (value / total) * 100;
    arcs.push({ key: slice.key, color: slice.color, len: pct, offset: 100 - consumed + 25 });
    consumed += pct;
  }
  // A slice with a neighbour on each side gives up half a gap at BOTH ends; a
  // lone slice keeps its full ring (a gap there reads as a nick), and the cut
  // never takes more than a quarter of a sliver — a 0.2% wedge would otherwise
  // vanish whole.
  if (arcs.length > 1) {
    for (const arc of arcs) {
      const cut = Math.min(SEG_GAP / 2, arc.len / 4);
      arc.len -= cut * 2;
      arc.offset -= cut;
    }
  }
  return arcs;
}
