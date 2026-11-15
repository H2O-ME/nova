/**
 * The transcript's SUMMARY GROUP model — the reference's
 * `groupConsecutiveAssistantSummaries` + `formatAssistantSummaryStatistics`
 * (`v4/conversationAssistantWorkItems.ts`), reduced to the facts this product's
 * work rows carry.
 *
 * A turn's work is usually a run of same-shaped calls: six reads, then two
 * shells, then an edit. The reference folds such a RUN of calls into one line —
 * 「已查阅 6 项，已执行 2 命令」 — and expands it on click, so a turn that used
 * twenty tools still reads as three lines at rest. Nova printed every call as
 * its own 24px row; on a long turn that buried the answer under forty lines of
 * 「运行命令」, which is the 「对话流太散」 half of the reported gap.
 *
 * Two rules matter and both are the reference's:
 *  1. A group is CONSECUTIVE. A text block, a subagent call, a plan or any
 *     unclassified tool is a boundary — it breaks the run rather than being
 *     folded into it, because those rows are each a different kind of act.
 *  2. A group of ONE is not a group. Grouping one row costs the reader a click
 *     and saves nothing, so it renders as the plain row.
 */
import type { ToolCallKind } from '@nova-agent/core';

/** The three statistics the reference counts. */
export type SummaryCategory = 'explore' | 'run' | 'change';

/**
 * One tool call's category, from the CALL's own `kind` — never from its name.
 * `kind` is the presentation layer's statement of what a call did
 * (`core/presentation.ts`), so this cannot drift from the cards that draw it.
 * @param kind - the call view's kind.
 * @returns the category, or null when the row is a boundary.
 */
export function summaryCategoryOf(kind: ToolCallKind): SummaryCategory | null {
  switch (kind) {
    case 'read':
    case 'search':
      return 'explore';
    case 'execute':
      return 'run';
    case 'edit':
    case 'write':
      return 'change';
    default:
      // job / subagents / plan / question / other: each is a different act with
      // its own row (a job can be stopped, a subagent opened, a question
      // answered), so folding one into a count would hide the only control it
      // has.
      return null;
  }
}

/** One member as the statistics need it: its category, or a reasoning row. */
export type SummaryMemberKind = SummaryCategory | 'think';

/**
 * The group's one line, in the reference's words.
 *
 * `completed` is the GROUP's own closure (its last member settled), matching
 * the reference's `completed` flag: a running group reads 「查阅 3 项」 (what is
 * happening), a settled one 「已查阅 3 项」 (what happened).
 * @param kinds - the members' categories, in group order.
 * @param completed - no member is still running.
 * @returns the joined sentence, or the reference's bare 「思考」 for a
 *   reasoning-only group.
 */
export function summaryStatistics(
  kinds: readonly SummaryMemberKind[],
  completed: boolean,
): string {
  let explore = 0;
  let run = 0;
  let change = 0;
  for (const kind of kinds) {
    if (kind === 'explore') explore += 1;
    else if (kind === 'run') run += 1;
    else if (kind === 'change') change += 1;
  }
  const parts: string[] = [];
  if (explore > 0) parts.push(`${completed ? '已查阅' : '查阅'} ${String(explore)} 项`);
  if (run > 0) parts.push(`${completed ? '已执行' : '执行'} ${String(run)} 命令`);
  if (change > 0) parts.push(`${completed ? '已修改' : '修改'} ${String(change)} 文件`);
  // A group of reasoning-only members has no counts; the reference names the act.
  return parts.length === 0 ? '思考' : parts.join('，');
}
