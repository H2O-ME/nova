/**
 * 任务: the background jobs of the live session.
 *
 * Rows come from the host's `list_jobs` answer — read-only, and deliberately
 * without output: the output ring is the MODEL's cursor (its `jobs` tool drains
 * it), so a panel that read it would be eating the agent's data. A row carries
 * the sampled progress line, which is the peek designed for exactly this.
 *
 * The row is the reference's (`ui-jobs/src/client/JobListAction.tsx`, MIT): a
 * state dot whose colour carries the five states, live rows as filled cards
 * with the label over a kind/progress/duration line, settled rows as one
 * receding line, and a chevron that opens the metadata the row cannot fit (the
 * reference opens the live OUTPUT there; output is out of scope — named
 * deviation). The stop button is a two-press affordance that arms on the first
 * press and fires on the second: a background command is somebody's work, and
 * one stray click must not kill it. Ordering, the dot vocabulary, the elapsed
 * clocks and the arm machine are all `tasks-model.ts` — this file only paints.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ClientFrame, WireJobRow } from '../types.js';
import { ChevronDownIcon, RefreshIcon, StopIcon } from '../icons.js';
import { formatDuration } from '../format.js';
import { RIGHTBAR_COPY } from './copy.js';
import { IconButton, Notice } from './kit.js';
import { StateDot } from '../tool/StateDot.js';
import {
  isLiveJob,
  jobDetail,
  jobDot,
  jobElapsedMs,
  jobHasMeta,
  jobMetaRows,
  jobStateWord,
  killPhaseTtlMs,
  orderedJobs,
  pressKill,
  type KillPhase,
} from './tasks-model.js';
import css from './TasksView.module.css';

export interface TasksViewProps {
  jobs: readonly WireJobRow[] | null;
  connected: boolean;
  send: (frame: ClientFrame) => void;
}

export function TasksView({ jobs, connected, send }: TasksViewProps): JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [kill, setKill] = useState<KillPhase | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Opening the page asks for the session's jobs; so does an explicit refresh.
  useEffect(() => {
    if (connected) send({ type: 'list_jobs' });
  }, [connected, send]);

  const ordered = useMemo(() => (jobs === null ? [] : orderedJobs(jobs)), [jobs]);
  // The clock only beats while something is running: a page of settled rows has
  // nothing that changes, and a 1 s tick over history is pure repainting.
  const live = jobs !== null && jobs.some((job) => isLiveJob(job.status));
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => { setNow(Date.now()); }, 1_000);
    return () => { window.clearInterval(id); };
  }, [live]);

  // A phase belongs to a running row: once the row settles (or the list no
  // longer carries it) the button is gone, and a phase left behind would stand
  // over the next row of the same id — or over a job nobody can stop.
  useEffect(() => {
    if (kill === null) return;
    const row = jobs?.find((job) => job.id === kill.id);
    if (row === undefined || row.status !== 'running') setKill(null);
  }, [jobs, kill]);

  // An armed button disarms itself (the reference's KILL_ARM_MS); a pending one
  // waits on the host, whose answer is the row's own status flip.
  useEffect(() => {
    if (kill === null) return;
    const ttl = killPhaseTtlMs(kill);
    if (ttl === null) return;
    const id = window.setTimeout(() => {
      setKill((current) => (current !== null && current.id === kill.id ? null : current));
    }, ttl);
    return () => { window.clearTimeout(id); };
  }, [kill]);

  const onKillPress = (id: string): void => {
    const pressed = pressKill(kill, id);
    setKill(pressed.phase);
    if (pressed.fire) send({ type: 'stop_job', id });
  };

  const refresh = (
    <IconButton label={RIGHTBAR_COPY['tasks.refresh']} size="sm" disabled={!connected} onClick={() => { send({ type: 'list_jobs' }); }}>
      <RefreshIcon />
    </IconButton>
  );

  if (jobs === null) return <Notice kind="loading">{RIGHTBAR_COPY['tasks.loading']}</Notice>;
  if (jobs.length === 0) {
    return (
      <div className={css.emptyCard} data-tasks-empty="">
        <span className={css.emptyTitle}>{RIGHTBAR_COPY['tasks.empty']}</span>
        <span className={css.emptyNote}>{RIGHTBAR_COPY['tasks.empty.note']}</span>
        {refresh}
      </div>
    );
  }
  return (
    <div className={css.view}>
      <div className={css.head}>
        <span className={css.title}>{RIGHTBAR_COPY['tasks.title']}</span>
        <span className={css.count}>{jobs.length}</span>
        {refresh}
      </div>
      <ul className={css.list} aria-label={RIGHTBAR_COPY['tasks.title']}>
        {ordered.map((job) => {
          const isLive = isLiveJob(job.status);
          const expandable = jobHasMeta(job);
          const opened = expanded === job.id;
          const detail = jobDetail(job);
          const word = jobStateWord(job.status);
          const elapsed = jobElapsedMs(job, now);
          const duration = elapsed === undefined ? undefined : formatDuration(elapsed);
          const durationTitle = duration === undefined
            ? undefined
            : (isLive ? RIGHTBAR_COPY['tasks.duration.live'] : RIGHTBAR_COPY['tasks.duration.done']).replace('{duration}', duration);
          const phase = kill !== null && kill.id === job.id ? kill.state : null;
          const stopLabel = phase === 'armed' ? RIGHTBAR_COPY['tasks.stop.action'] : RIGHTBAR_COPY['tasks.stop.row'].replace('{label}', job.label);
          const body = isLive ? (
            <>
              <StateDot state={jobDot(job.status)} />
              <span className={css.main}>
                <span className={css.primary}>
                  <span className={css.label} title={job.label}>{job.label}</span>
                </span>
                <span className={css.secondary} title={detail ?? word}>
                  <span className={css.kind}>{job.kind}</span>
                  {detail !== undefined && <span className={css.status}>{detail}</span>}
                  {duration !== undefined && <span className={css.duration} title={durationTitle}>{duration}</span>}
                </span>
              </span>
              <span className={css.chevronBox}>
                <ChevronDownIcon className={opened ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
              </span>
            </>
          ) : (
            <>
              <StateDot state={jobDot(job.status)} />
              <span className={css.kind}>{job.kind}</span>
              <span className={css.label} title={job.label}>{job.label}</span>
              <span className={css.status} title={detail ?? word}>{detail ?? word}</span>
              {duration !== undefined && <span className={css.duration} title={durationTitle}>{duration}</span>}
              {expandable && (
                <span className={css.chevronBox}>
                  <ChevronDownIcon className={opened ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
                </span>
              )}
            </>
          );
          return (
            <li key={job.id} className={css.item}>
              <div className={isLive ? `${css.rowLine} ${css.rowLineLive}` : css.rowLine}>
                {expandable ? (
                  <button
                    type="button"
                    className={isLive ? css.row : `${css.row} ${css.rowSettled}`}
                    aria-expanded={opened}
                    aria-label={(opened ? RIGHTBAR_COPY['tasks.collapse'] : RIGHTBAR_COPY['tasks.expand']).replace('{label}', job.label)}
                    onClick={() => { setExpanded(opened ? null : job.id); }}
                  >
                    {body}
                  </button>
                ) : (
                  <span className={`${css.row} ${css.rowSettled} ${css.rowStatic}`}>{body}</span>
                )}
                {job.status === 'running' && (
                  <button
                    type="button"
                    className={phase === 'armed' ? `${css.stop} ${css.stopArmed}` : css.stop}
                    data-kill-state={phase ?? 'idle'}
                    disabled={!connected || phase === 'pending'}
                    aria-label={stopLabel}
                    title={phase === 'armed' ? RIGHTBAR_COPY['tasks.stop.confirm'] : stopLabel}
                    onClick={() => { onKillPress(job.id); }}
                  >
                    <StopIcon />
                    {phase === 'armed' && <span className={css.stopLabel}>{RIGHTBAR_COPY['tasks.stop.action']}</span>}
                  </button>
                )}
              </div>
              {opened && (
                <div className={css.panel}>
                  {jobMetaRows(job, now).map((meta) => (
                    <div key={meta.key} className={css.metaRow}>
                      <span className={css.metaKey}>{RIGHTBAR_COPY[meta.key]}</span>
                      <span className={css.metaValue} title={meta.value}>{meta.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
