/**
 * The 任务 page's model (`rightbar/tasks-model.ts`).
 *
 * Each case here is a rule the reference states once and a rewrite can quietly
 * invert while every row still renders: the ordering (live leads, settled
 * newest-first), the dot vocabulary (`stopping`/`killed` share attention, not
 * the running spinner), the frozen settle clock (a settled duration that ticks
 * is finished work looking busy), replace-not-merge folding (a dropped progress
 * line must actually drop), and the two-press machine (a stray first press
 * arms, a stray second one on ANOTHER row arms that row).
 */
import { describe, expect, it } from 'vitest';
import type { WireJobRow } from '../src/types.js';
import {
  JOB_KILL_ARM_MS,
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
  upsertJobRow,
  type KillPhase,
} from '../src/rightbar/tasks-model.js';

function row(over: Partial<WireJobRow> = {}): WireJobRow {
  return { id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running', ...over };
}

describe('task rows', () => {
  it('leads with live work in start order, then settles newest-first', () => {
    const ordered = orderedJobs([
      row({ id: 'old-done', status: 'completed', startedAt: 100, finishedAt: 900 }),
      row({ id: 'live-late', startedAt: 500 }),
      row({ id: 'new-done', status: 'completed', startedAt: 400, finishedAt: 700 }),
      row({ id: 'live-early', startedAt: 300 }),
    ]);
    expect(ordered.map((job) => job.id)).toEqual(['live-early', 'live-late', 'old-done', 'new-done']);
  });

  it('breaks a same-millisecond settle tie back to start order', () => {
    // Two rows settling together must not fall back on the host's map order.
    const ordered = orderedJobs([
      row({ id: 'second', status: 'completed', startedAt: 200, finishedAt: 800 }),
      row({ id: 'first', status: 'completed', startedAt: 100, finishedAt: 800 }),
    ]);
    expect(ordered.map((job) => job.id)).toEqual(['first', 'second']);
  });

  it('reads stopping and killed as attention, not as running or idle', () => {
    // The dot is the row's only state marker in a scan: a stopping job that
    // spins like a running one, or a killed job that reads as untroubled, is
    // the failure this pins.
    expect(jobDot('running')).toBe('ongoing');
    expect(jobDot('stopping')).toBe('warning');
    expect(jobDot('killed')).toBe('warning');
    expect(jobDot('completed')).toBe('done');
    expect(jobDot('failed')).toBe('error');
    expect(jobDot('something-else')).toBe('idle');
    expect(isLiveJob('stopping')).toBe(true);
    expect(isLiveJob('killed')).toBe(false);
    expect(jobStateWord('killed')).toBe('已取消');
  });

  it('freezes a settled duration at finishedAt and ticks a live one', () => {
    const live = row({ startedAt: 1_000 });
    expect(jobElapsedMs(live, 4_500)).toBe(3_500);
    const settled = row({ status: 'completed', startedAt: 1_000, finishedAt: 4_000 });
    expect(jobElapsedMs(settled, 999_000)).toBe(3_000);
    // A legacy row the host never dated: 0, NOT now-minus-start — a duration
    // that grows forever is the visible lie.
    const undated = row({ status: 'killed', startedAt: 1_000 });
    expect(jobElapsedMs(undated, 999_000)).toBe(0);
    expect(jobElapsedMs(row({ startedAt: undefined }), 5_000)).toBeUndefined();
  });

  it('reads progress first, treats an empty sample as absent', () => {
    expect(jobDetail(row({ progress: 'step 3', detail: 'exit code: 0' }))).toBe('step 3');
    expect(jobDetail(row({ progress: '', detail: 'exit code: 0' }))).toBe('exit code: 0');
    expect(jobDetail(row({ detail: '' }))).toBeUndefined();
    expect(jobDetail(row({}))).toBeUndefined();
  });
});

describe('live job folding', () => {
  it('replaces by id rather than merging — a dropped field stays dropped', () => {
    const rows = [row({ id: 'bash-1', progress: 'step 1' }), row({ id: 'bash-2', status: 'completed' })];
    const next = upsertJobRow(rows, row({ id: 'bash-1', status: 'completed', finishedAt: 5 }));
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(row({ id: 'bash-1', status: 'completed', finishedAt: 5 }));
    // The untouched row keeps its identity and position; the original array is
    // not mutated (the reducer hands the old state to React).
    expect(next[1]).toBe(rows[1]);
    expect(rows[0]?.progress).toBe('step 1');
  });

  it('appends a job the list has not seen', () => {
    const next = upsertJobRow([row({ id: 'bash-1' })], row({ id: 'bash-2' }));
    expect(next.map((job) => job.id)).toEqual(['bash-1', 'bash-2']);
  });
});

describe('the two-press stop', () => {
  it('arms on the first press and fires on the second', () => {
    const armed = pressKill(null, 'bash-1');
    expect(armed).toEqual({ phase: { id: 'bash-1', state: 'armed' }, fire: false });
    const fired = pressKill(armed.phase, 'bash-1');
    expect(fired).toEqual({ phase: { id: 'bash-1', state: 'pending' }, fire: true });
  });

  it('does not fire a repeat press while the request is in flight', () => {
    const pending: KillPhase = { id: 'bash-1', state: 'pending' };
    expect(pressKill(pending, 'bash-1')).toEqual({ phase: pending, fire: false });
  });

  it('moves the armed state to whichever row was pressed last', () => {
    // A confirmation is about ONE job: pressing another row must disarm the
    // first (or, worse, the next press on the first row would fire).
    const first = pressKill(null, 'bash-1');
    const second = pressKill(first.phase, 'bash-2');
    expect(second).toEqual({ phase: { id: 'bash-2', state: 'armed' }, fire: false });
  });

  it('disarms an armed press on a timer and lets a pending one wait', () => {
    expect(killPhaseTtlMs({ id: 'bash-1', state: 'armed' })).toBe(JOB_KILL_ARM_MS);
    expect(killPhaseTtlMs({ id: 'bash-1', state: 'pending' })).toBeNull();
  });
});

describe('the expanded metadata', () => {
  it('offers the chevron to every live row and to settled rows that carry more', () => {
    expect(jobHasMeta(row({}))).toBe(true);
    expect(jobHasMeta(row({ status: 'completed', finishedAt: 10 }))).toBe(true);
    expect(jobHasMeta(row({ status: 'completed', progress: 'last line' }))).toBe(true);
    // Nothing behind it: a legacy settled row the host dated neither way.
    expect(jobHasMeta(row({ status: 'killed' }))).toBe(false);
  });

  it('lists progress, then the clocks, then the id the model addresses', () => {
    const now = new Date(2026, 9, 3, 12, 0, 0).getTime();
    const live = jobMetaRows(row({ startedAt: now - 60_000, progress: 'running 12 tests' }), now);
    expect(live.map((meta) => meta.key)).toEqual(['tasks.meta.progress', 'tasks.meta.started', 'tasks.meta.id']);
    expect(live[0]?.value).toBe('running 12 tests');
    expect(live[1]?.value).toBe('11:59');
    const settled = jobMetaRows(row({ status: 'completed', startedAt: now - 60_000, finishedAt: now - 30_000, progress: 'done' }), now);
    // A settled row's progress is history the row itself no longer shows as
    // progress; the panel gives the clocks instead.
    expect(settled.map((meta) => meta.key)).toEqual(['tasks.meta.started', 'tasks.meta.finished', 'tasks.meta.id']);
    expect(settled[1]?.value).toBe('11:59');
  });

  it('keeps the id last even when the host dated nothing', () => {
    const meta = jobMetaRows(row({ id: 'subagent-7', status: 'failed' }));
    expect(meta).toEqual([{ key: 'tasks.meta.id', value: 'subagent-7' }]);
  });
});
