/**
 * A turn's process group — port of the harness `ui-chat`'s `ChatGroupSeat`
 * (c) 2026 DeepSeek — MIT License: the group's own disclosure header
 * ({@link ProcessGroupHead}) above a bounded body. The reference bounds every
 * settled group: the members scroll inside `min(400px, 50vh)` with gradient
 * fades over whichever end can still scroll. That cap is the whole point — a
 * turn with forty tool calls must not bury its own answer, and the reader must
 * be able to tell "the group continues" from "the transcript ends".
 *
 * The disclosure defaults CLOSED, so a settled turn's steps read as one
 * summary line (已读取文件并搜索代码…) until the reader asks for them — the
 * work-details setting's 「工作步骤过多时自动折叠概况」. A LIVE group under the
 * same rule shows the running title instead; the policy decides whether its
 * task detail rides along. Ungrouped (`stepGrouping: 'none'`, or the live turn
 * under `history`) there is no header and no cap: the steps flow flat.
 */
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { ProcessGroupHead } from './ProcessGroupHead.js';
import { useCappedEdges } from './use-capped-edges.js';
import css from './ProcessGroup.module.css';

export interface ProcessGroupProps {
  /** The group's rows, in order. */
  children: ReactNode;
  /** The turn is still running: the title shimmers and reads the live activity. */
  live: boolean;
  /** Draw the disclosure header and cap the body; without it the steps flow flat. */
  grouped?: boolean | undefined;
  /** A settled group's summary title (the closed disclosure's words). */
  summary?: string | undefined;
  /** A live group's running title (activity + task detail per the policy). */
  liveTitle?: string | undefined;
}

export function ProcessGroup({ children, live, grouped = false, summary, liveTitle }: ProcessGroupProps): JSX.Element {
  /** The group's own disclosure, closed by default (the reference's `useDisclosure`). */
  const [open, setOpen] = useState(false);
  const toggle = useCallback((): void => { setOpen((current) => !current); }, []);
  // A capped group's fades follow its scroll position and its content growth.
  // A live or hidden group has no measurable end, so it never measures.
  const { bodyRef, up, down } = useCappedEdges(!live && !(grouped && !open), children);

  // The reference's split: an UNGROUPED flow is flat (uncapped, wider rhythm);
  // a grouped one caps even while live — the reader opened it knowingly, and
  // a run that never stops growing must not bury the page with it.
  const bodyClass = !grouped
    ? `${css.body} ${css.expandedBody}`
    : [css.body, up ? css.fadeTop : '', down ? css.fadeBottom : ''].filter(Boolean).join(' ');

  if (!grouped) {
    return (
      <div className={css.root}>
        <div ref={bodyRef} className={bodyClass} data-step-process-body="">
          <div className={css.content} data-step-process-content="">{children}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={css.root} data-step-process="">
      <ProcessGroupHead
        title={live ? liveTitle ?? '正在分析请求' : summary ?? '已完成分析'}
        live={live}
        open={open}
        onToggle={toggle}
        label={live ? '进行中的工作步骤' : '本次回合的工作步骤'}
      />
      <div
        ref={bodyRef}
        className={bodyClass}
        hidden={!open}
        data-step-process-body=""
        data-group-expanded-mode={!grouped || undefined}
      >
        <div className={css.content} data-step-process-content="">{children}</div>
      </div>
    </div>
  );
}
