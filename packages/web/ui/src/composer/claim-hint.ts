/**
 * The composer's claim hint: the ghost line drawn after the draft while a
 * command's arguments are still blank.
 *
 * Ported from the reference's composer (`ui-conversation/src/client/skeleton/
 * InputBar.tsx`, its `hint` prop, and `ui-conversation/src/client/locales.ts`
 * for the copy — the reference ships a zh sheet, so the wording below is its
 * own, not a translation of it).
 *
 * The one decision worth pinning is the DISAMBIGUATION. `/goal` means two
 * different things depending on whether a goal is already in force, so the hint
 * is looked up as `hint.<name>` or `hint.<name>.active` — the reference's own
 * key rule (`hint.${commandName === 'goal' && hasGoal ? 'goal.active' :
 * commandName}`). Without it, a reader who is already running a goal is invited
 * to describe an objective the command would refuse. The reference counts ANY
 * stored goal as `hasGoal` (a complete one included); this mirrors that rather
 * than inventing a finer rule.
 */

import { draftCommand } from './command-menu.js';
import type { CommandSummary } from '../types.js';

/** `hint.goal`: what a blank `/goal` offers when no goal is in force. */
export const GOAL_HINT = '输入目标，智能体将持续执行';

/** `hint.goal.active`: the same seat once a goal is in force. */
export const GOAL_ACTIVE_HINT = '当前目标进行中。可输入 edit 修改 / pause 暂停 / resume 继续 / clear 清除';

/** The command the `.active` variant belongs to. */
const GOAL = 'goal';

/**
 * The hint dictionary, keyed exactly as the reference keys it: the bare command
 * name, plus the one state-dependent variant.
 */
const HINTS: Readonly<Record<string, string>> = {
  [GOAL]: GOAL_HINT,
  [`${GOAL}.active`]: GOAL_ACTIVE_HINT,
};

/**
 * The hint for the claim the draft holds, or null when there is none to draw.
 *
 * Three gates, each of them a reason NOT to draw a line: the draft must be a
 * command this kernel's registry claims (an unclaimed `/word` is sent as an
 * ordinary prompt, so hinting it would promise a delivery that never happens),
 * its arguments must still be blank (once the reader is typing the objective,
 * the line is their own text — and a hint implies a single-line token draft),
 * and the command must have an entry in the dictionary above.
 * @param draft - the full draft text.
 * @param commands - the kernel's catalog (`ready.commands`).
 * @param hasGoal - whether a goal is already stored: the disambiguation input.
 * @returns the hint text, or null.
 */
export function claimHint(
  draft: string,
  commands: readonly CommandSummary[],
  hasGoal: boolean,
): string | null {
  const claim = draftCommand(draft);
  if (claim === null || claim.args !== '') return null;
  if (!commands.some((command) => command.name === claim.name)) return null;
  const key = claim.name === GOAL && hasGoal ? `${GOAL}.active` : claim.name;
  return HINTS[key] ?? null;
}
