/**
 * The goal bar: the session's durable goal, docked above the plan on the
 * composer stack — port of the harness `ui-goal`'s `GoalBar.tsx` +
 * `GoalBar.module.css` (c) 2026 DeepSeek — MIT License: a single 36px line
 * with the goal glyph, the phase label, the truncated objective, and icon
 * actions (pause / resume, edit — an inline form in the same strip, see
 * `GoalEditRow` — and clear). The three composer-stack cards (queue panel,
 * goal, plan) read as one family: same card width, same 36px line, same menu
 * material.
 *
 * Deviations from the source, both deliberate:
 *  - a `blocked` goal shows 受阻的目标 with the reason as the row's tooltip
 *    (the source reads its reason off the blocked phase too);
 *  - actions send the SAME `/goal` command frames the composer sends
 *    (`pause` / `resume` / `clear` / `edit <objective>`), so a click here and
 *    a typed command are one fact; the source calls host verbs directly. There
 *    is no inline error line for the same reason: a refused command's reason
 *    lands in the transcript as its own command row, one owner for the answer.
 */
import { useEffect, useState } from 'react';
import type { ClientFrame, Goal, GoalStatus } from '../types.js';
import { GoalIcon, PauseIcon, PencilIcon, PlayIcon, TrashIcon } from '../icons.js';
import { Tooltip } from '../shell/Tooltip.js';
import { GoalEditRow } from './GoalEditRow.js';
import css from './GoalPanel.module.css';

/** The phase label per visible status (harness `phase.*` copy). */
const PHASE_LABELS: Record<Exclude<GoalStatus, 'complete'>, string> = {
  active: '进行中的目标',
  paused: '已暂停的目标',
  blocked: '受阻的目标',
};

/**
 * The bar. Renders nothing without a goal (the dock closes up) and nothing for
 * a completed one (the source's own rule — a finished goal is history, and the
 * transcript holds it).
 */
export function GoalPanel({ goal, send }: {
  goal: Goal | null;
  /** The socket's send, so the bar's actions are the `/goal` command frames. */
  send: (frame: ClientFrame) => void;
}): JSX.Element | null {
  const [editing, setEditing] = useState(false);
  // A new goal identity (cleared / replaced externally) invalidates a local
  // edit: without the reset a surviving draft's Enter would write over the NEW
  // goal (the source's own effect).
  const goalId = goal?.id;
  useEffect(() => {
    setEditing(false);
  }, [goalId]);
  if (goal === null || goal.status === 'complete') return null;

  const run = (args: string): void => { send({ type: 'command', name: 'goal', args }); };
  if (editing) {
    return (
      <div className={css.dock} data-goal-bar="">
        <div className={css.bar}>
          <GoalEditRow
            objective={goal.objective}
            onSave={(objective) => { run(`edit ${objective}`); setEditing(false); }}
            onCancel={() => { setEditing(false); }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={css.dock} data-goal-bar="">
      <div className={css.bar} title={goal.blockedReason}>
        <span className={css.goalGlyph}><GoalIcon /></span>
        <span className={css.label}>{PHASE_LABELS[goal.status]}</span>
        <span className={css.objective}>{goal.objective}</span>
        <div className={css.actions}>
          {goal.status === 'active' && (
            <Tooltip label="暂停目标" side="bottom" delayMs={500}>
              <button type="button" className={css.iconBtn} onClick={() => { run('pause'); }} aria-label="暂停目标">
                <PauseIcon />
              </button>
            </Tooltip>
          )}
          {goal.status === 'paused' && (
            <Tooltip label="恢复目标" side="bottom" delayMs={500}>
              <button type="button" className={css.iconBtn} onClick={() => { run('resume'); }} aria-label="恢复目标">
                <PlayIcon />
              </button>
            </Tooltip>
          )}
          <Tooltip label="编辑目标" side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.iconBtn}
              onClick={() => { setEditing(true); }}
              aria-label="编辑目标"
            >
              <PencilIcon />
            </button>
          </Tooltip>
          <Tooltip label="清除目标" side="bottom" delayMs={500}>
            <button type="button" className={css.iconBtn} onClick={() => { run('clear'); }} aria-label="清除目标">
              <TrashIcon />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
