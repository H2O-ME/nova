/**
 * Movement and entry/exit fades for the sidebar's keyed rows.
 * Ported from deepseek-harness `ui-workspace/src/client/rows/AnimatedRows.tsx`
 * (c) 2026 DeepSeek — MIT License.
 *
 * The technique is FLIP, driven by React's own commit: `getSnapshotBeforeUpdate`
 * runs while the DOM still shows the OLD list, so it can record where every row
 * was; `componentDidUpdate` then runs against the new DOM and animates each row
 * from its recorded position to its current one. Nothing measures on a timer
 * and nothing polls — a list that did not change does no work at all.
 *
 * A class component is not a style preference here: `getSnapshotBeforeUpdate`
 * has no hook equivalent, and the "read the layout before the browser paints"
 * timing is the entire mechanism.
 *
 * Three of the reference's gates are kept verbatim, each for a failure it
 * prevents:
 *  - **`ready`** — the sidebar renders a loading placeholder, then the first
 *    real list. Animating that transition would slide every row in from
 *    nowhere on every page load.
 *  - **`resetKey`** — a mode switch, a new search, or a group fold REPLACES the
 *    view rather than reordering it. Rows that merely look similar must not be
 *    flown across the panel as if they were the same row.
 *  - **armed on first input** — the first paint after a switch is not a user
 *    action, so it should not animate. Motion starts once the pointer or the
 *    keyboard has been used inside the list, which is the first moment a
 *    movement can be a response to something.
 */
import { Component, createRef, type ReactNode } from 'react';
import css from './AnimatedRows.module.css';

/** How long a row takes to fade in or out. */
const ROW_FADE_MS = 100;
/** How long a row takes to travel to its new position. */
const ROW_GLIDE_MS = 200;

export interface AnimatedRowsProps {
  children: ReactNode;
  /** The list element's class (the scroller the overlay is positioned in). */
  className: string | undefined;
  /** The list's accessible name (`role="tree"`'s label). */
  label: string;
  /**
   * Keys in DOM order, matching the rendered `data-row-key` attributes. The
   * comparison of two of these arrays is what decides whether anything moved.
   */
  rowKeys: readonly string[];
  /** False while the placeholder is showing (see the note above). */
  ready: boolean;
  /** A change to this value means the view was replaced, not reordered. */
  resetKey: string;
}

/** Where one row was, and how opaque it looked, before the update. */
interface RowPosition {
  element: HTMLElement;
  rect: DOMRect;
  opacity: number;
}

/** What the pre-update pass hands to the post-update pass. */
interface RowSnapshot {
  positions: Map<string, RowPosition>;
  /** Clones of the rows leaving, kept alive to fade out. */
  removed: Map<string, RowPosition>;
}

/** Whether the two renders contain the same rows in the same order. */
function sameRows(previous: AnimatedRowsProps, next: AnimatedRowsProps): boolean {
  return previous.rowKeys.length === next.rowKeys.length
    && previous.rowKeys.every((key, index) => key === next.rowKeys[index]);
}

/** Whether a row is on screen at all (an off-screen row has no motion to show). */
function intersects(row: DOMRect, viewport: DOMRect): boolean {
  return row.bottom > viewport.top && row.top < viewport.bottom
    && row.right > viewport.left && row.left < viewport.right;
}

export class AnimatedRows extends Component<AnimatedRowsProps> {
  /** False until the pointer or keyboard has been used inside the list. */
  private armed = false;
  private readonly list = createRef<HTMLDivElement>();
  private readonly overlay = createRef<HTMLDivElement>();
  /** Glides in flight, so the next update can cancel them before re-measuring. */
  private readonly movements = new Map<HTMLElement, Animation>();
  private readonly exits = new Map<string, { element: HTMLElement; animation: Animation }>();

  override getSnapshotBeforeUpdate(previous: AnimatedRowsProps): RowSnapshot | null {
    const list = this.list.current;
    if (!this.armed || sameRows(previous, this.props) || previous.resetKey !== this.props.resetKey
      || !previous.ready || !this.props.ready || list === null
      // `animate` is absent in a DOM without the Web Animations API (and in the
      // test environment); without it there is no animation to run.
      || typeof list.animate !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

    const viewport = list.getBoundingClientRect();
    const positions = this.readPositions();
    const nextKeys = new Set(this.props.rowKeys);
    const removed = new Map<string, RowPosition>();
    for (const [key, row] of positions) {
      if (nextKeys.has(key) || !intersects(row.rect, viewport)) continue;
      // A leaving row is gone from the new render, so it survives as an inert
      // CLONE in an overlay: the real element's React node is unmounted, and a
      // row that vanished instantly has nothing to fade.
      const clone = row.element.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-row-key');
      clone.inert = true;
      removed.set(key, { ...row, element: clone });
    }
    return { positions, removed };
  }

  override componentDidUpdate(previous: AnimatedRowsProps, _state: unknown, snapshot: RowSnapshot | null): void {
    if (snapshot === null) {
      // The update was refused (not armed, reduced motion, view replaced), so
      // any animation still running belongs to a view that no longer exists.
      if (!sameRows(previous, this.props) || previous.resetKey !== this.props.resetKey
        || previous.ready !== this.props.ready) this.clear();
      return;
    }

    this.cancelMovements();
    const list = this.list.current as HTMLDivElement;
    const overlay = this.overlay.current as HTMLDivElement;
    const viewport = list.getBoundingClientRect();
    // The overlay's own origin: an exit clone is positioned in overlay
    // coordinates, which are not the viewport's once it has been scrolled.
    const origin = overlay.getBoundingClientRect();
    const positions = this.readPositions();

    for (const [key, row] of positions) {
      // A row that came back keeps its identity: cancel its fade-out rather
      // than letting the clone finish and the row restart from opacity 0.
      this.removeExit(key);
      const previousRow = snapshot.positions.get(key);
      if (!intersects(row.rect, viewport)
        && (previousRow === undefined || !intersects(previousRow.rect, viewport))) continue;
      if (previousRow === undefined) {
        this.move(row.element, [{ opacity: 0 }, { opacity: 1 }], ROW_FADE_MS);
        continue;
      }
      const dx = previousRow.rect.left - row.rect.left;
      const dy = previousRow.rect.top - row.rect.top;
      if (dx === 0 && dy === 0 && previousRow.opacity === 1) continue;
      this.move(row.element, [
        { transform: `translate(${String(dx)}px, ${String(dy)}px)`, opacity: previousRow.opacity },
        { transform: 'translate(0, 0)', opacity: 1 },
      ], ROW_GLIDE_MS);
    }

    for (const [key, row] of snapshot.removed) {
      const { element } = row;
      this.removeExit(key);
      // Absolute placement at the row's old spot: the clone is out of flow, so
      // the rows below it collapse immediately and the fade reads as a removal
      // rather than a gap closing slowly.
      Object.assign(element.style, {
        position: 'absolute', margin: '0', transform: 'none', boxSizing: 'border-box',
        left: `${String(row.rect.left - origin.left)}px`,
        top: `${String(row.rect.top - origin.top)}px`,
        width: `${String(row.rect.width)}px`, height: `${String(row.rect.height)}px`,
      });
      overlay.append(element);
      const animation = element.animate([{ opacity: row.opacity }, { opacity: 0 }], {
        duration: ROW_FADE_MS, easing: 'ease-out', fill: 'forwards',
      });
      this.exits.set(key, { element, animation });
      animation.onfinish = () => { this.removeExit(key); };
    }
  }

  override componentWillUnmount(): void {
    this.clear();
  }

  /** Every rendered row's key, element, position, and current opacity. */
  private readPositions(): Map<string, RowPosition> {
    const list = this.list.current as HTMLDivElement;
    const rows = list.querySelectorAll<HTMLElement>('[data-row-key]');
    return new Map(Array.from(rows, (element) => [element.dataset.rowKey as string, {
      element,
      rect: element.getBoundingClientRect(),
      // A row mid-glide is at partial opacity; reading the computed value keeps
      // a second update from snapping it back to full.
      opacity: this.movements.has(element) ? Number(getComputedStyle(element).opacity) : 1,
    }]));
  }

  /** Run one animation and remember it, so the next update can cancel it. */
  private move(element: HTMLElement, keyframes: Keyframe[], duration: number): void {
    const animation = element.animate(keyframes, { duration, easing: 'ease-out' });
    this.movements.set(element, animation);
    animation.onfinish = () => { this.movements.delete(element); animation.cancel(); };
  }

  private cancelMovements(): void {
    for (const animation of this.movements.values()) {
      animation.onfinish = null;
      animation.cancel();
    }
    this.movements.clear();
  }

  private removeExit(key: string): void {
    const exit = this.exits.get(key);
    if (exit === undefined) return;
    exit.animation.onfinish = null;
    exit.animation.cancel();
    exit.element.remove();
    this.exits.delete(key);
  }

  private clear(): void {
    this.cancelMovements();
    for (const key of this.exits.keys()) this.removeExit(key);
  }

  override render(): ReactNode {
    return (
      <>
        <div
          ref={this.list}
          className={this.props.className}
          role="tree"
          aria-label={this.props.label}
          // Capture, so a handler on an inner row cannot swallow the gesture
          // that arms motion for the whole list.
          onPointerDownCapture={() => { this.armed = true; }}
          onKeyDownCapture={() => { this.armed = true; }}
        >
          {this.props.children}
        </div>
        <div ref={this.overlay} className={css.exits} aria-hidden="true" />
      </>
    );
  }
}
