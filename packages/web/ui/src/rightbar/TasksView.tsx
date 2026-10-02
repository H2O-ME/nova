/**
 * 任务: the background jobs of the live session.
 *
 * Rows come from the host's `list_jobs` answer — read-only, and deliberately
 * without output: the output ring is the MODEL's cursor (its `jobs` tool drains
 * it), so a panel that read it would be eating the agent's data. A row carries
 * the sampled progress line, which is the peek designed for exactly this.
 *
 * The row shape is the reference's jobs drawer (`dsh-better-sidebar`
 * `JobsDrawer.tsx`, MIT), which is a CARD and not a text line: a status dot,
 * the job's label in mono on the first line, the Tag-styled status word beside
 * it, the progress/detail line on the second line as the tail, and a stop
 * button that ARMS on the first click and fires on the second (a background
 * command is somebody's work; one stray click must not kill it). The empty
 * state is one centered card, not two stacked notices — 「没有任务」 and
 * 「为什么没有」 belong to the same reading.
 */
import { useEffect, useRef, useState } from 'react';
import type { ClientFrame, WireJobRow } from '../types.js';
import { RefreshIcon } from '../icons.js';
import { formatDuration } from '../format.js';
import { RIGHTBAR_COPY } from './copy.js';
import { IconButton, Notice, StateDot } from './kit.js';
import css from './TasksView.module.css';

/** How long an armed stop button waits before it disarms itself. */
export const JOB_KILL_ARM_MS = 3000;

export interface TasksViewProps {
  jobs: readonly WireJobRow[] | null;
  connected: boolean;
  send: (frame: ClientFrame) => void;
}

export function TasksView({ jobs, connected, send }: TasksViewProps): JSX.Element {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  // Opening the page asks for the session's jobs; so does an explicit refresh.
  useEffect(() => {
    if (connected) send({ type: 'list_jobs' });
  }, [connected, send]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const arm = (id: string): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setArmed(id);
    timer.current = window.setTimeout(() => { setArmed(null); }, JOB_KILL_ARM_MS);
  };

  if (jobs === null) return <Notice kind="loading">{RIGHTBAR_COPY['tasks.loading']}</Notice>;
  if (jobs.length === 0) {
    return (
      <div className={css.emptyCard} data-tasks-empty="">
        <span className={css.emptyTitle}>{RIGHTBAR_COPY['tasks.empty']}</span>
        <span className={css.emptyNote}>{RIGHTBAR_COPY['tasks.empty.note']}</span>
        <IconButton label={RIGHTBAR_COPY['tasks.refresh']} size="sm" disabled={!connected} onClick={() => { send({ type: 'list_jobs' }); }}>
          <RefreshIcon />
        </IconButton>
      </div>
    );
  }
  return (
    <div className={css.view}>
      <div className={css.head}>
        <span className={css.title}>{RIGHTBAR_COPY['tasks.title']}</span>
        <span className={css.count}>{jobs.length}</span>
        <IconButton label={RIGHTBAR_COPY['tasks.refresh']} size="sm" disabled={!connected} onClick={() => { send({ type: 'list_jobs' }); }}>
          <RefreshIcon />
        </IconButton>
      </div>
      <ul className={css.list}>
        {jobs.map((job) => {
          const settled = job.status !== 'running' && job.status !== 'stopping';
          const tail = job.progress !== undefined && job.progress !== ''
            ? job.progress
            : job.detail !== undefined && job.detail !== '' ? job.detail : '';
          const live = job.startedAt !== undefined && !settled
            ? formatDuration(Date.now() - job.startedAt)
            : '';
          return (
            <li key={job.id} className={css.row} data-settled={settled ? '' : undefined}>
              <StateDot state={dotOf(job.status)} />
              <span className={css.body}>
                <span className={css.line}>
                  <span className={css.label} title={job.label}>{job.label}</span>
                  <span className={css.kind}>{job.kind}</span>
                  <span className={css.tag} data-tasks-tag="" data-status={job.status}>{statusWord(job.status)}</span>
                  {(tail !== '' || live !== '') && <span className={css.spacer} />}
                  {live !== '' && <span className={css.meta}>{live}</span>}
                </span>
                {tail !== '' && <span className={css.progress} title={tail}>{tail}</span>}
              </span>
              {!settled && (
                <span className={css.killSlot}>
                  <button
                    type="button"
                    className={css.kill}
                    data-armed={armed === job.id ? '' : undefined}
                    aria-label={RIGHTBAR_COPY['tasks.stop']}
                    title={armed === job.id ? RIGHTBAR_COPY['tasks.stop.confirm'] : RIGHTBAR_COPY['tasks.stop']}
                    disabled={!connected}
                    onClick={() => {
                      if (armed !== job.id) { arm(job.id); return; }
                      setArmed(null);
                      send({ type: 'stop_job', id: job.id });
                    }}
                  >
                    {armed === job.id ? RIGHTBAR_COPY['tasks.stop.confirm'] : RIGHTBAR_COPY['tasks.stop']}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The dot a job's status draws. */
function dotOf(status: string): 'ongoing' | 'done' | 'error' | 'idle' {
  if (status === 'running' || status === 'stopping') return 'ongoing';
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'error';
  return 'idle';
}

/** The status word a row carries (the kernel's own five states). */
function statusWord(status: string): string {
  if (status === 'running') return RIGHTBAR_COPY['tasks.running'];
  if (status === 'stopping') return RIGHTBAR_COPY['tasks.stopping'];
  if (status === 'completed') return RIGHTBAR_COPY['tasks.completed'];
  if (status === 'failed') return RIGHTBAR_COPY['tasks.failed'];
  return RIGHTBAR_COPY['tasks.killed'];
}
