/**
 * A turn's process group — port of the harness `ui-chat`'s `ChatGroupSeat`
 * body (c) 2026 DeepSeek — MIT License.
 *
 * The reference bounds every settled group: the members scroll inside
 * `min(400px, 50vh)` with gradient fades over whichever end can still scroll.
 * That cap is the whole point — a turn with forty tool calls must not bury its
 * own answer, and the reader must be able to tell "the group continues" from
 * "the transcript ends". A LIVE turn is the exception: its steps are the
 * progress being watched, so capping them would hide what the reader is
 * waiting on (the reference's `grouped` split).
 *
 * What this port does NOT take from the reference: the group's own header
 * (`.title` with the activity-icon ⇄ chevron crossfade). Here the turn's
 * {@link TurnHeader} is that disclosure and sits above this box in the flow, so
 * a second header would be two controls for one fold.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import css from './ProcessGroup.module.css';

export interface ProcessGroupProps {
  /** The group's rows, in order. */
  children: ReactNode;
  /** The turn is still running: the group is uncapped (see the file comment). */
  live: boolean;
}

export function ProcessGroup({ children, live }: ProcessGroupProps): JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** Which ends can still scroll — the fade mask reads these. */
  const [edges, setEdges] = useState({ up: false, down: false });

  const measure = useCallback((): void => {
    const box = bodyRef.current;
    if (box === null) return;
    setEdges({
      up: box.scrollTop > 1,
      down: box.scrollTop + box.clientHeight < box.scrollHeight - 1,
    });
  }, []);

  // A capped group's fades follow its scroll position and its content growth
  // (an arriving row changes what is clipped). An uncapped group has no
  // scrollable end, so it never measures.
  useEffect(() => {
    const box = bodyRef.current;
    if (box === null || live) return;
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      box.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure, live, children]);

  const bodyClass = live
    ? `${css.body} ${css.expandedBody}`
    : [css.body, edges.up ? css.fadeTop : '', edges.down ? css.fadeBottom : ''].filter(Boolean).join(' ');

  return (
    <div className={css.root}>
      <div ref={bodyRef} className={bodyClass} data-step-process-body="">
        <div className={css.content} data-step-process-content="">{children}</div>
      </div>
    </div>
  );
}
