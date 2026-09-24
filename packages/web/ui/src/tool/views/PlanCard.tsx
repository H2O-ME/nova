/**
 * The plan card: a `todo_write` snapshot drawn as a checklist. This card has no
 * harness counterpart — the harness's todo row shows the counts in its summary
 * and falls back to the generic IN/OUT body — so the chrome follows the card
 * family (banner + rows + fold, `PlanCard.module.css`) while the counts and the
 * status semantics come from the harness `planSummary`.
 */
import { useState } from 'react';
import { headTailCap, foldLabels, planSummary, type PlanItem } from '../cards.js';
import { CheckIcon, CircleIcon, PlayIcon } from '../../icons.js';
import css from './PlanCard.module.css';

/** Items shown before the height cap collapses the middle (the card family's cap). */
export const CHAT_PLAN_MAX_LINES = 8;

const LABELS = foldLabels('', '任务');

export interface PlanCardProps {
  items: readonly PlanItem[];
  /** Height cap in rows; `Infinity` disables it (the detail panel). */
  maxLines?: number;
}

export function PlanCard({ items, maxLines = CHAT_PLAN_MAX_LINES }: PlanCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const summary = planSummary(items);
  const { hidden, capped, headLines, tailLines } = headTailCap(items.length, maxLines, expanded);
  const head = capped ? items.slice(0, headLines) : items;
  const tail = capped ? items.slice(items.length - tailLines) : [];
  return (
    <div className={css.block}>
      <div className={css.header}>
        <span className={css.summary}>
          {summary.done}/{summary.total} 已完成
          {summary.active > 0 ? ` · ${summary.active} 进行中` : ''}
          {summary.activeExtra > 0 ? ` · 首个：${summary.activeContent ?? ''}` : ''}
        </span>
      </div>
      <div className={css.body}>
        {head.map((item, index) => (
          <PlanLine key={index} item={item} />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            className={css.expand}
            aria-expanded={expanded}
            aria-label={expanded ? LABELS.collapseAria : LABELS.expandAria(hidden)}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? LABELS.collapse : LABELS.expand(hidden)}
          </button>
        )}
        {tail.map((item, index) => (
          <PlanLine key={`tail-${index}`} item={item} />
        ))}
      </div>
    </div>
  );
}

/** One item: a status mark and its text. */
function PlanLine({ item }: { item: PlanItem }): JSX.Element {
  return (
    <div className={css.line} data-status={item.status}>
      <span className={css.mark}>
        {item.status === 'completed' ? <CheckIcon /> : item.status === 'in_progress' ? <PlayIcon /> : <CircleIcon />}
      </span>
      {item.text}
    </div>
  );
}