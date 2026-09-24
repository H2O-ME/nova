/**
 * The card's expanded body, per shell — one component per card kind, shared by
 * the transcript row (`maxLines` at the card family's cap) and the detail panel
 * (`maxLines: Infinity`, the whole body).
 */
import type { BodyShell, RowSlots } from '../model.js';
import { DiffCard } from './DiffCard.js';
import { GenericCard } from './GenericCard.js';
import { PlanCard } from './PlanCard.js';
import { ReadCard } from './ReadCard.js';
import { SearchCard } from './SearchCard.js';
import { TerminalCard } from './TerminalCard.js';

export interface CardBodyProps {
  shell: BodyShell;
  /** The row's slots (the terminal banner falls back to the row's summary). */
  slots: RowSlots;
  cwd: string | undefined;
  home: string | undefined;
  /** The call failed: the IN/OUT card's output takes the error color. */
  failed: boolean;
  /** Row cap forwarded to the folding cards; `Infinity` = draw the body whole. */
  maxLines?: number | undefined;
}

export function CardBody({ shell, slots, cwd, home, failed, maxLines }: CardBodyProps): JSX.Element | null {
  switch (shell.card) {
    case 'terminal':
      return <TerminalCard shell={shell} cwd={cwd} home={home} collapsedSummary={slots.summary} />;
    case 'diff':
      return <DiffCard shell={shell} maxLines={maxLines} />;
    case 'read':
      return <ReadCard path={shell.path} window={shell.window} truncated={shell.truncated} maxLines={maxLines} />;
    case 'search':
      return <SearchCard shell={shell} maxLines={maxLines} />;
    case 'plan':
      return <PlanCard items={shell.items} maxLines={maxLines} />;
    case 'io':
      return <GenericCard input={shell.input} output={shell.output} failed={failed} />;
    case 'none':
      return null;
  }
}