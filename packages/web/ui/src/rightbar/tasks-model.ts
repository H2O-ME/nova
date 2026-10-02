/**
 * The 任务 page's model: ordering, the dot/word vocabulary, elapsed time, the
 * metadata rows, and the two-press stop machine.
 *
 * Pure and DOM-free because each of these is a rule the reference states once
 * (`ui-jobs/src/client/JobListAction.tsx`, MIT) and a rewrite can quietly
 * invert: live rows lead in start order, settled rows follow newest-settled
 * first (ties back to start order, so the sort never depends on the host's map
 * iteration), `stopping` and `killed` share the attention colour — both mean
 * the work ended on request rather than on its own — and a stop needs a second
 * press inside `JOB_KILL_ARM_MS`. A settled row's duration is frozen at
 * `finishedAt`: a repaint must never make finished work look like it is still
 * growing. The view below only paints what this file decides.
 */
import type { WireJobRow } from '../types.js';
import { formatClock } from '../format.js';
import { RIGHTBAR_COPY } from './copy.js';

/**
 * How long an armed stop waits for its confirming press before disarming.
 *
 * The reference's `KILL_ARM_MS`: long enough to read the widened pill, short
 * enough that a stray first press cannot leave a live weapon on the row.
 */
export const JOB_KILL_ARM_MS = 3000;

/** The states a row's dot can take (a superset of the four the panel used). */
export type JobDot = 'ongoing' | 'done' | 'error' | 'warning' | 'idle';

/** Whether a job is still work rather than history. */
export function isLiveJob(status: string): boolean {
  return status === 'running' || status === 'stopping';
}

/**
 * Status marker semantics — the reference's `dotState`, verbatim.
 *
 * `stopping` and `killed` are `warning` rather than `ongoing`/`idle`: a job
 * that was asked to stop is neither progressing nor merely finished, and the
 * amber dot is the one reading that says so. The previous panel mapped both to
 * `ongoing` (a stopping job looked like it was working) and `killed` to `idle`
 * (a stopped job looked untroubled) — the states were there, the meanings were
 * not.
 * @param status - the kernel's job status.
 */
export function jobDot(status: string): JobDot {
  if (status === 'running') return 'ongoing';
  if (status === 'stopping') return 'warning';
  if (status === 'completed') return 'done';
  if (status === 'killed') return 'warning';
  if (status === 'failed') return 'error';
  return 'idle';
}

/** The status word a row reads out (also the fallback for a missing detail). */
export function jobStateWord(status: string): string {
  if (status === 'running') return RIGHTBAR_COPY['tasks.running'];
  if (status === 'stopping') return RIGHTBAR_COPY['tasks.stopping'];
  if (status === 'completed') return RIGHTBAR_COPY['tasks.completed'];
  if (status === 'failed') return RIGHTBAR_COPY['tasks.failed'];
  return RIGHTBAR_COPY['tasks.killed'];
}

/**
 * The one-line qualifier beside the status: live progress while running, the
 * terminal reason once settled (the reference's `jobDetail`).
 *
 * Empty strings read as absent: producers hand out `''` for "nothing yet", and
 * a blank line renders as a gap where the status word should be.
 * @param row - the job row.
 */
export function jobDetail(row: WireJobRow): string | undefined {
  if (row.progress !== undefined && row.progress !== '') return row.progress;
  return row.detail !== undefined && row.detail !== '' ? row.detail : undefined;
}

/**
 * Elapsed milliseconds, or undefined when the host never dated the job.
 *
 * Live rows tick against `nowMs`; settled rows are frozen at `finishedAt`.
 * A settled row that predates the field falls back to its start (0 ms of
 * duration) rather than to the wall clock — the alternative is a duration that
 * grows every second for work that stopped an hour ago.
 * @param row - the job row.
 * @param nowMs - the view's clock sample.
 */
export function jobElapsedMs(row: WireJobRow, nowMs: number): number | undefined {
  if (row.startedAt === undefined) return undefined;
  const end = isLiveJob(row.status) ? nowMs : row.finishedAt ?? row.startedAt;
  return Math.max(0, end - row.startedAt);
}

/**
 * Live rows first in start order, then settled rows newest-first — the
 * reference's `ordered()`. Rows without a start time sort as the oldest.
 * @param rows - the rows as the host listed them (start order).
 */
export function orderedJobs(rows: readonly WireJobRow[]): WireJobRow[] {
  return [...rows].sort((left, right) => {
    const liveLeft = isLiveJob(left.status);
    if (liveLeft !== isLiveJob(right.status)) return liveLeft ? -1 : 1;
    const leftStart = left.startedAt ?? 0;
    const rightStart = right.startedAt ?? 0;
    if (liveLeft) return leftStart - rightStart;
    const settled = (right.finishedAt ?? rightStart) - (left.finishedAt ?? leftStart);
    return settled !== 0 ? settled : leftStart - rightStart;
  });
}

/**
 * Fold one live update into the tasks list: replace by id, append when new.
 *
 * REPLACE, not merge: a snapshot is the whole truth of a row at that moment,
 * and the kernel omits optional fields that are absent — a merge would keep a
 * progress line the producer has already stopped sampling, forever. The host's
 * `list_jobs` answer does the same, so a row arrived at live and the same row
 * arrived at by refresh cannot read differently.
 * @param rows - the current list.
 * @param row - the update.
 */
export function upsertJobRow(rows: readonly WireJobRow[], row: WireJobRow): WireJobRow[] {
  const at = rows.findIndex((existing) => existing.id === row.id);
  if (at < 0) return [...rows, row];
  const next = [...rows];
  next[at] = row;
  return next;
}

/** The two phases of the stop affordance this surface can actually observe. */
export type KillState = 'armed' | 'pending';

/** One row's stop button state; the row id is carried so a phase cannot leak. */
export interface KillPhase {
  id: string;
  state: KillState;
}

/**
 * One press of the stop button.
 *
 * The first press only arms; the second — same row, still armed — fires and
 * the phase moves to `pending`, where further presses are inert until the
 * row's own status flip removes the button. A press on a DIFFERENT row arms
 * that row instead: the confirmation is about one specific job, so moving the
 * cursor must not carry the armed state across.
 *
 * There is no `failed` phase (the reference has one behind its kill RPC): our
 * `stop_job` frame is fire-and-forget — no answer frame exists — so a rejected
 * kill is unobservable here and claiming "停止失败" would be an invention. The
 * named deviation: the button's answer is the row's status, or nothing.
 * @param current - the phase already on screen, if any.
 * @param id - the row this press belongs to.
 */
export function pressKill(current: KillPhase | null, id: string): { phase: KillPhase | null; fire: boolean } {
  if (current === null || current.id !== id) return { phase: { id, state: 'armed' }, fire: false };
  if (current.state === 'armed') return { phase: { id, state: 'pending' }, fire: true };
  // `pending`: the request is already out; a repeat press is not a second kill.
  return { phase: current, fire: false };
}

/**
 * How long a phase survives on its own: an armed button disarms after
 * `JOB_KILL_ARM_MS`, a pending one waits on the host (its clock is the row's
 * status flip, which clears the button entirely).
 * @param phase - the phase to time.
 */
export function killPhaseTtlMs(phase: KillPhase): number | null {
  return phase.state === 'armed' ? JOB_KILL_ARM_MS : null;
}

/** The row keys the expanded panel can carry, in reading order. */
export type JobMetaKey = 'tasks.meta.progress' | 'tasks.meta.started' | 'tasks.meta.finished' | 'tasks.meta.id';

/** One line of the expanded metadata panel. */
export interface JobMetaRow {
  key: JobMetaKey;
  value: string;
}

/**
 * Whether the chevron (and the panel behind it) exists for a row.
 *
 * The reference's rule is "an observable row": live work, or a settled job
 * that left output behind. Output is out of scope here (read-only rows by
 * design — see `job-frames.ts`), so the thing behind our chevron is the
 * metadata a row cannot fit: the full progress line and the exact start/finish
 * clocks. A settled row from a host that dated neither has nothing behind it
 * and renders static, exactly like the reference's output-less row.
 * @param row - the job row.
 */
export function jobHasMeta(row: WireJobRow): boolean {
  return isLiveJob(row.status) || row.finishedAt !== undefined || jobDetail(row) !== undefined;
}

/**
 * The expanded panel's lines: the full progress sample, then the clocks the
 * row only implies, then the id the model's `jobs` tool addresses the job by.
 * @param row - the job row.
 * @param nowMs - the clock `formatClock` reads "today" against.
 */
export function jobMetaRows(row: WireJobRow, nowMs: number = Date.now()): JobMetaRow[] {
  const rows: JobMetaRow[] = [];
  const detail = jobDetail(row);
  if (isLiveJob(row.status) && detail !== undefined) rows.push({ key: 'tasks.meta.progress', value: detail });
  if (row.startedAt !== undefined) rows.push({ key: 'tasks.meta.started', value: formatClock(row.startedAt, nowMs) });
  if (row.finishedAt !== undefined) rows.push({ key: 'tasks.meta.finished', value: formatClock(row.finishedAt, nowMs) });
  rows.push({ key: 'tasks.meta.id', value: row.id });
  return rows;
}
