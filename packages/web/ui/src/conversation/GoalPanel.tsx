/**
 * The goal panel: the session's durable goal, on the composer dock above the plan.
 *
 * Same two rules as `TodoPanel` (dsh's choice, and the reason this reads as one
 * family): collapsed by default, and absent when there is no goal — the dock closes
 * up rather than reserving space for a state most sessions are never in.
 *
 * It differs from the plan in one way that matters for reading: a goal is a single
 * objective with a PROGRESS BUDGET, so the header shows the objective and the round
 * count rather than a per-status tally. `rounds/maxRounds` is the honest
 * "how much longer will this keep going" number, and a `blocked` goal shows the
 * reason — the one case where the operator must act.
 */
import { useState } from 'react';
import type { Goal, GoalStatus } from '../types.js';
import { ChevronDownIcon, ChevronUpIcon } from '../icons.js';
import { StateDot } from '../tool/StateDot.js';
import css from './GoalPanel.module.css';

/** The status language the dot shares with tool rows. */
function dotState(status: GoalStatus): 'done' | 'ongoing' | 'idle' | 'error' {
  switch (status) {
    case 'complete':
      return 'done';
    case 'active':
      return 'ongoing';
    case 'blocked':
      return 'error';
    default:
      return 'idle';
  }
}

/** The status word shown next to the objective. */
function statusLabel(status: GoalStatus): string {
  switch (status) {
    case 'active':
      return '进行中';
    case 'paused':
      return '已暂停';
    case 'blocked':
      return '受阻';
    default:
      return '已完成';
  }
}

/**
 * The header's progress reading: the round budget, and the reason when blocked.
 * @param goal - the goal in force.
 * @returns the summary text.
 */
export function goalProgressLabel(goal: Goal): string {
  const rounds = `${String(goal.rounds)}/${String(goal.maxRounds)} 轮`;
  return goal.blockedReason === undefined ? rounds : `${rounds}\u2002·\u2002${goal.blockedReason}`;
}

/** The panel. Renders nothing without a goal, so the dock closes up. */
export function GoalPanel({ goal, defaultCollapsed = true }: {
  goal: Goal | null;
  /** Whether the panel starts folded; collapsed by default (see `TodoPanel`). */
  defaultCollapsed?: boolean;
}): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (goal === null) return null;
  return (
    <section className={css.root} aria-label="目标">
      <div className={css.body}>
        <button
          type="button"
          className={css.header}
          aria-expanded={!collapsed}
          onClick={() => { setCollapsed((value) => !value); }}
        >
          <span className={css.glyph} role="img" aria-label={statusLabel(goal.status)}>
            <StateDot state={dotState(goal.status)} />
          </span>
          <span className={css.title}>目标</span>
          {/* The objective is the one thing worth reading at a glance, so it is
              the header's own text rather than a detail behind the fold. */}
          <span className={css.objective}>{goal.objective}</span>
          <span className={css.progress}>{goalProgressLabel(goal)}</span>
          <span className={css.chevron} aria-hidden>
            {collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </span>
        </button>
        {!collapsed && (
          <ul className={css.list}>
            <li className={css.item}>
              <span className={css.label}>状态</span>
              <span className={css.value}>{statusLabel(goal.status)}</span>
            </li>
            <li className={css.item}>
              <span className={css.label}>轮次</span>
              <span className={css.value}>{`${String(goal.rounds)}/${String(goal.maxRounds)}`}</span>
            </li>
            {goal.blockedReason !== undefined && (
              <li className={css.item}>
                <span className={css.label}>受阻原因</span>
                <span className={css.value}>{goal.blockedReason}</span>
              </li>
            )}
            {/* The id is the handle a log reader / `/goal` output shares, so it is
                shown in the fold rather than in the at-a-glance line. */}
            <li className={css.item}>
              <span className={css.label}>编号</span>
              <span className={css.value}>{goal.id}</span>
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}
