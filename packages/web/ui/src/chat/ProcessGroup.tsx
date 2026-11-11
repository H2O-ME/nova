/**
 * A turn's process container: the group's members, nothing more.
 *
 * This used to be a SECOND disclosure — its own header with its own
 * `useState`, closed by default, sitting under the turn header that already
 * folds the same rows. A reader who opened a turn then met a summary line they
 * had to click again, and the two states could disagree: the turn says open,
 * the group says closed, and the steps stay invisible. That is the
 * "two implementations of one fact" family (`docs/NOVA-GENERALIST.md`), and the
 * cure is one owner, not a third component.
 *
 * The single fold now lives in the turn header (`openTurns` in `flow.tsx`).
 * This file is the box that fold reveals: it caps its height so a forty-step
 * turn cannot bury the answer it belongs to, and fades whichever end can still
 * scroll. The turn header carries the summary words (`ProcessGroupHead` is
 * gone with its state).
 */
import type { ReactNode } from 'react';
import { useCappedEdges } from './use-capped-edges.js';
import css from './ProcessGroup.module.css';

export interface ProcessGroupProps {
  /** The group's rows, in order. */
  children: ReactNode;
  /** The group's turn is still running: the cap follows its growth. */
  live: boolean;
}

export function ProcessGroup({ children, live }: ProcessGroupProps): JSX.Element {
  // The fades follow the scroll position and the content's growth. A live group
  // has no settled end to measure, so it re-measures on every change.
  const { bodyRef, up, down } = useCappedEdges(!live, children);

  return (
    <div className={css.root} data-step-process="">
      <div
        ref={bodyRef}
        className={[css.body, up ? css.fadeTop : '', down ? css.fadeBottom : ''].filter(Boolean).join(' ')}
        data-step-process-body=""
      >
        <div className={css.content} data-step-process-content="">{children}</div>
      </div>
    </div>
  );
}
