/**
 * Live status rows: one background job, one nested subagent. Both are "one row
 * per entity, rewritten in place" rows — the transcript's own vocabulary
 * (`state.ts` mints them and updates them by id) — so they live here rather
 * than in the message flow.
 *
 * Density and tone follow the tool-row family: 24px line, a 10px state dot
 * (`tool/StateDot`, the one dot recipe in this surface), tabular figures for
 * the elapsed column.
 */
import { useEffect, useState } from 'react';
import { StateDot, type StateDotState } from '../tool/StateDot.js';
import { formatDuration, subagentTotals } from '../format.js';
import type { JobSnapshot } from '../types.js';
import type { SubRow } from '../state.js';
import css from './StatusRows.module.css';

const JOB_STATUS_LABELS: Record<JobSnapshot['status'], string> = {
  running: '运行中',
  stopping: '停止中',
  completed: '已完成',
  killed: '已停止',
  failed: '失败',
};

const SUB_STATUS_LABELS: Record<SubRow['status'], string> = {
  running: '运行中',
  completed: '已完成',
  aborted: '已中断',
  ended: '已结束',
};

function jobDot(status: JobSnapshot['status']): StateDotState {
  switch (status) {
    case 'running':
    case 'stopping':
      return 'ongoing';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    case 'killed':
      return 'idle';
  }
}

function subDot(status: SubRow['status']): StateDotState {
  if (status === 'running') return 'ongoing';
  return status === 'completed' ? 'done' : 'idle';
}

/**
 * One background job. Elapsed is the reader's clock, not the kernel's: one
 * interval per running row (never a timer in the reducer — a fresh
 * `job_update` without a timestamp would have to invent what "now" means).
 */
export function JobRow({ job, onStop }: { job: JobSnapshot; onStop: (id: string) => void }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.status !== 'running' && job.status !== 'stopping') return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [job.status]);
  const busy = job.status === 'running' || job.status === 'stopping';
  return (
    <div className={css.row} data-state={job.status}>
      <StateDot state={jobDot(job.status)} />
      <span className={css.id}>
        {job.kind === 'subagent' ? '子代理' : '后台'} {job.id}
      </span>
      <span className={css.label}>{job.label}</span>
      <span className={css.meta}>{JOB_STATUS_LABELS[job.status]}</span>
      {job.startedAt !== undefined && (
        <span className={css.meta}>{formatDuration(Math.max(0, now - job.startedAt))}</span>
      )}
      {job.detail !== undefined && <span className={css.detail}>{job.detail}</span>}
      {busy && (
        <button
          type="button"
          className={css.stop}
          onClick={() => onStop(job.id)}
          disabled={job.status === 'stopping'}
          title={`停止 ${job.id}`}
          aria-label={`停止后台任务 ${job.id}`}
        >
          {job.status === 'stopping' ? '停止中' : '停止'}
        </button>
      )}
      {job.progress !== undefined && <span className={css.progress}>{job.progress}</span>}
    </div>
  );
}

/**
 * One slash command the user ran (`/compact`): the same row recipe as a job —
 * a state dot, the name in the id seat, the command's own words as the detail.
 * It is here because a command is a thing the user DID to the session: it earns
 * a line in the transcript, in the order it happened, the way a prompt does.
 */
export function CommandRow({ name, running, text }: { name: string; running: boolean; text?: string }): JSX.Element {
  return (
    <div className={css.row} data-state={running ? 'running' : 'completed'}>
      <StateDot state={running ? 'ongoing' : 'done'} />
      <span className={css.id}>/{name}</span>
      <span className={css.meta}>{running ? '执行中' : '已完成'}</span>
      {text !== undefined && text !== '' && <span className={css.detail}>{text}</span>}
    </div>
  );
}

/**
 * A nested subagent: one row per label, rewritten in place. It exists because
 * the parent's tool row only says "subagent is running" — the nested loop's own
 * activity (which tool, how many, how long, how much it cost) is a separate
 * feed, and a user watching a long delegation has nothing else to read.
 */
export function SubagentRow({ sub }: { sub: SubRow }): JSX.Element {
  const running = sub.status === 'running';
  return (
    <div className={css.row} data-state={sub.status}>
      <StateDot state={subDot(sub.status)} />
      <span className={css.label}>{sub.label}</span>
      <span className={css.meta}>{sub.calls} 次调用</span>
      {running
        ? sub.detail !== undefined && <span className={css.detail}>{sub.detail}</span>
        : (
          <span className={css.meta}>
            {SUB_STATUS_LABELS[sub.status]}
            {sub.usage !== undefined ? ` · ${subagentTotals(sub.usage)}` : ''}
          </span>
        )}
    </div>
  );
}