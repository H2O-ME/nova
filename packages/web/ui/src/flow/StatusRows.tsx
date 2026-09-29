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
import { DisclosureRow } from '../chat/DisclosureRow.js';
import { ContextGlyph14 } from '../chat/glyphs.js';
import { TextShimmer } from '../shell/TextShimmer.js';
import { StateDot, type StateDotState } from '../tool/StateDot.js';
import { formatDuration, formatTokens, subagentTotals } from '../format.js';
import type { JobSnapshot } from '../types.js';
import type { SubRow } from '../state.js';
import css from './StatusRows.module.css';

/** Harness `ui-jobs` `status.*` copy. */
const JOB_STATUS_LABELS: Record<JobSnapshot['status'], string> = {
  running: '运行中',
  stopping: '正在停止',
  completed: '已完成',
  killed: '已取消',
  failed: '已失败',
};

/** Harness `ui-subagent` `activity.*` copy, which the nested loop's status maps onto. */
const SUB_STATUS_LABELS: Record<SubRow['status'], string> = {
  running: '正在运行',
  completed: '已完成',
  aborted: '当前未运行',
  ended: '当前未运行',
};

/**
 * Read one row out of a closed status table by a value that arrived on the wire.
 *
 * `TABLE[status]` is NOT safe here: these keys come from a `job_update` /
 * `subagent_update` frame, so a status naming an `Object.prototype` member
 * (`constructor`, `toString`) returns the inherited FUNCTION and the `??`
 * fallback that would have caught it never fires — the row then renders that
 * function's source text into the transcript. `Object.hasOwn` is the guard; the
 * unknown value falls back to the neutral in-progress word rather than being
 * dropped, because a row with a status this build does not know is still a row.
 * @param table - the closed label table.
 * @param status - the status read off the wire.
 * @param fallback - the word for a status this build does not know.
 * @returns the localized label, or the fallback.
 */
function statusLabel<T extends string>(table: Record<T, string>, status: T, fallback: string): string {
  return Object.hasOwn(table, status) ? table[status] : fallback;
}

/**
 * Status marker semantics, verbatim harness `ui-jobs/JobListAction.tsx`: `stopping`
 * and `killed` share the attention color, because both mean the work ended (or is
 * ending) on request rather than on its own.
 */
function jobDot(status: JobSnapshot['status']): StateDotState {
  switch (status) {
    case 'running':
      return 'ongoing';
    case 'stopping':
    case 'killed':
      return 'warning';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
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
      <span className={css.meta}>{statusLabel(JOB_STATUS_LABELS, job.status, '运行中')}</span>
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
 * One slash command the user ran (`/compact`) — port of the harness
 * `ui-chat`'s `GenericCommandCard` (c) 2026 DeepSeek — MIT License: the same
 * 24px disclosure row the tool rows use, whose summary is the command's own
 * output (shimmering while it runs) and whose body is the full multiline text
 * when there is one. It is here because a command is a thing the user DID to
 * the session: it earns a line in the transcript, in the order it happened,
 * the way a prompt does.
 *
 * The row is expandable exactly when the output spans lines — a one-line
 * command has nothing to reveal (the reference's `body !== null` rule), so it
 * renders as a plain summary rather than a control that opens onto itself.
 */
export function CommandRow({ name, running, text }: { name: string; running: boolean; text?: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const state = running ? 'running' : 'ok';
  const summary = text ?? (running ? '执行中' : '已完成');
  const body = text !== undefined && text.includes('\n') ? text : null;
  const open = expanded && body !== null;

  return (
    <div className={css.commandRoot} data-variant="others" data-state={state}>
      {running && <span className={css.visuallyHidden}>命令执行中</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<ContextGlyph14 />}
        title={`/${name}`}
        running={running}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded((value) => !value); }}
        collapsedContent={(
          <>
            <span className={css.sep} aria-hidden="true" />
            <span className={css.commandSummary}>
              <TextShimmer active={running}>{summary}</TextShimmer>
            </span>
          </>
        )}
      >
        {open && body !== null ? <pre className={css.commandBody}>{body}</pre> : undefined}
      </DisclosureRow>
    </div>
  );
}

/**
 * A nested subagent: one row per label, rewritten in place. It exists because
 * the parent's tool row only says "subagent is running" — the nested loop's own
 * activity (which tool, how many, how long, how much it cost) is a separate
 * feed, and a user watching a long delegation has nothing else to read.
 *
 * The layout is the harness `ui-subagent` `SubagentHeaderLineage` catalog row's:
 * the label on its own line, the harness's `title · mode · activity` clause
 * beneath it, and the two right-aligned metrics (`tokens.total`, the active
 * duration) in a two-row grid. Two facts the harness reads from its session
 * projection have no producer here and are therefore absent rather than faked:
 * the entry `mode` (`mode.oneShot` / `mode.continuable` / `mode.unknown` — no
 * tool reports it) and `subagentTiming.lastTurnCompleted` (which is what lets
 * the harness say 已完成 while the entry is still `inactive`); this row reads the
 * nested loop's own terminal status instead.
 */
export function SubagentRow({ sub }: { sub: SubRow }): JSX.Element {
  const running = sub.status === 'running';
  const usage = sub.usage;
  const tokens = usage === undefined ? 0 : usage.promptTokens + usage.completionTokens;
  const active = running ? '正在运行' : statusLabel(SUB_STATUS_LABELS, sub.status, '当前未运行');
  // The clause's leading fact is whatever the row knows about the delegation's
  // own content: the nested tool it is on while it runs (the harness reads its
  // session title here — a fact this surface's progress feed does not carry), or
  // its call count once it settled. Joined from non-empty values only, like the
  // harness, so a subagent that has not called a tool yet shows its activity
  // word alone.
  const lead = sub.detail ?? (sub.calls > 0 ? `${sub.calls} 次调用` : undefined);
  const clause = [lead, active].filter((value): value is string => value !== undefined && value !== '').join(' · ');
  return (
    <div className={`${css.row} ${css.subRow}`} data-state={sub.status}>
      <span className={css.activitySlot}>
        <StateDot state={subDot(sub.status)} />
      </span>
      <span className={css.content}>
        <span className={css.label}>{sub.label}</span>
        <span className={css.summary}>{clause}</span>
      </span>
      {usage !== undefined && (
        // The harness joins the same two readings into one `metrics` string and
        // keeps the full form on the row's accessible name; here it is the
        // metrics group's tooltip, so the compact pair stays legible without
        // losing the turn count the compact form has no room for.
        <span className={css.metrics} title={subagentTotals(usage)}>
          {tokens > 0 && <span className={css.metricToken}>{formatTokens(tokens)} tok</span>}
          <span className={css.metricDuration}>{formatDuration(usage.elapsedMs)}</span>
        </span>
      )}
    </div>
  );
}
