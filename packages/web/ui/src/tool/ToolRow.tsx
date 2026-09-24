/**
 * The transcript's tool row — the ported deepseek-harness `ui-tool` row
 * (MIT, see `ToolRow.module.css`) over this frontend's card vocabulary.
 *
 * All reasoning lives in `card-view.ts` (which card, which headline, did it
 * fail, what footnote) and `model.ts` (title/summary/suffix slots, the expanded
 * body's shape, the row-state marks); this file is the dumb projection onto
 * JSX. No tool name is compared here, and a card this bundle has never seen
 * still renders — it falls to the IN/OUT body.
 *
 * Shape (harness ToolRow): one 24px row, collapsed by default; the running
 * state is a glare band sweeping the row, not a spinner. Expanding draws the
 * card's own body — a terminal banner, a real diff, numbered read lines, a
 * grouped search, a plan list — or the IN/OUT card for a card-less call. The
 * 详情 pill is a SIBLING of the row (harness discipline: no nested interactive
 * elements), appearing in flow under an expanded body.
 */
import { memo, useMemo, useState, type KeyboardEvent } from 'react';
import { toolCardModel, type CardModel } from '../card-view.js';
import { ChevronDownIcon } from '../icons.js';
import { BashIcon, BrowseIcon, ChecklistIcon, EditIcon, InspectIcon, SearchToolIcon, ToolIcon } from './icons.js';
import { bodyShell, rowDot, rowSlots, rowStatusLabel, rowVariant, type RowSlots, type RowVariant } from './model.js';
import { StateDot } from './StateDot.js';
import { CardBody } from './views/CardBody.js';
import type { ToolCallView, ToolResultView } from '../types.js';
import css from './ToolRow.module.css';

export interface ToolRowProps {
  callId: string;
  name: string;
  /** The call's original argument JSON (the IN section / the panel). */
  args: string;
  view: ToolCallView;
  /** Absent until the call reports — the row renders as in-flight. */
  result: ToolResultView | undefined;
  /** The result's flattened text (read windows; the panel shows it whole). */
  output?: string | undefined;
  /** Live tail line while the call runs (bash output so far). */
  tail?: string | undefined;
  /** Nothing is running: an unfinished call is a leftover, not in flight. */
  idle: boolean;
  /** This call is the one open in the detail panel. */
  selected: boolean;
  /** Flow identity for prepend re-anchoring. */
  anchorKey: string;
  /** Stable dispatcher (takes the id, so the prop identity survives renders). */
  onOpen: (callId: string) => void;
  /** Session workspace root, for the terminal banner's prompt label. */
  cwd?: string | undefined;
  /** Host account home, so a cwd equal to it collapses to `~`. */
  home?: string | undefined;
}

/**
 * Memoized: a streaming delta rewrites one block, and the transcript re-renders
 * every row from that — the model (and, for the open row, the whole LCS diff)
 * must not be rebuilt for calls that did not change. All props are primitives or
 * identities the reducer preserves, so the default shallow compare holds.
 */
export const ToolRow = memo(function ToolRow({
  callId,
  name,
  args,
  view,
  result,
  output,
  tail,
  idle,
  selected,
  anchorKey,
  onOpen,
  cwd,
  home,
}: ToolRowProps): JSX.Element {
  const model = useMemo(() => toolCardModel({ name, args, view, result, idle }), [name, args, view, result, idle]);
  const slots = useMemo(() => rowSlots({ name, view, model }), [name, view, model]);
  const shell = useMemo(
    () => bodyShell({ view, body: model.body, result, model, output, tail, args }),
    [view, model, result, output, tail, args],
  );
  const variant = useMemo(() => rowVariant(view, model.body), [view, model.body]);
  const [expanded, setExpanded] = useState(false);
  // A body exists only when there is something to read in it.
  const expandable = shell.card !== 'none' && !(shell.card === 'io' && shell.input === null && shell.output === null);
  const open = expanded && expandable;
  const status = rowStatusLabel(model.state);
  const toggle = (): void => setExpanded((value) => !value);
  // The running tail lives in the card while the row is open, and as one muted
  // line under the row while it is not (our kernel streams it; the harness has
  // no equivalent field — the line is marked surface-local in the stylesheet).
  const showTail = model.state === 'running' && !open && tail !== undefined && tail !== '';
  return (
    <div className={css.root} data-anchor-key={anchorKey} data-state={model.state}>
      {status !== null && <span className={css.visuallyHidden}>{status}</span>}
      <RowHead
        state={model.state}
        variant={variant}
        plan={model.body.kind === 'plan'}
        slots={slots}
        open={open}
        expandable={expandable}
        onToggle={toggle}
      />
      {showTail && <div className={css.liveTail}>{tail}</div>}
      {open && (
        <div className={css.bodyWrap}>
          <CardBody shell={shell} slots={slots} cwd={cwd} home={home} failed={model.state === 'fail'} />
          <InspectPill name={name} selected={selected} onOpen={() => onOpen(callId)} />
        </div>
      )}
    </div>
  );
});

/** The 24px disclosure line: leading glyph or state dot, title, summary, suffix. */
function RowHead({
  state,
  variant,
  plan,
  slots,
  open,
  expandable,
  onToggle,
}: {
  state: CardModel['state'];
  variant: RowVariant;
  plan: boolean;
  slots: RowSlots;
  open: boolean;
  expandable: boolean;
  onToggle: () => void;
}): JSX.Element {
  const dot = rowDot(state);
  const glyph = dot === null ? cardGlyph(variant, plan) : <StateDot state={dot} />;
  const leading = open
    ? <ChevronDownIcon className={css.chevron} />
    : expandable
      ? (
        <>
          <span className={css.iconIdle}>{glyph}</span>
          <ChevronDownIcon className={`${css.chevron} ${css.chevronHover}`} />
        </>
      )
      : glyph;
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onToggle();
  };
  return (
    <div
      className={css.row}
      data-expandable={expandable || undefined}
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
      aria-expanded={expandable ? open : undefined}
      onClick={expandable ? onToggle : undefined}
      onKeyDown={expandable ? toggleFromKeyboard : undefined}
    >
      <span className={css.leading}>{leading}</span>
      <span className={css.title}>{slots.title}</span>
      {slots.summary !== '' && (
        <>
          <span className={css.sep} aria-hidden />
          <span className={css.summary} data-mono={slots.mono || undefined}>
            {slots.summary}
          </span>
          {slots.suffix !== null && (
            <span className={suffixClass(slots)}>{slots.suffix}</span>
          )}
        </>
      )}
    </div>
  );
}

/** The trailing fragment's class set: diff totals take the code font, failures the error tone. */
function suffixClass(slots: RowSlots): string {
  const base = css.summarySuffix ?? '';
  const extra = slots.suffixTone === 'diff' ? css.diffStat : slots.suffixTone === 'fail' ? css.errorSummary : undefined;
  return extra === undefined ? base : `${base} ${extra}`;
}

/** The leading glyph per card (harness `VARIANT_ICONS`, on this icon set). */
function cardGlyph(variant: RowVariant, plan: boolean): JSX.Element {
  if (plan) return <ChecklistIcon />;
  switch (variant) {
    case 'bash':
      return <BashIcon />;
    case 'read':
      return <BrowseIcon />;
    case 'write':
    case 'edit':
      return <EditIcon />;
    case 'search':
      return <SearchToolIcon />;
    case 'others':
      return <ToolIcon />;
  }
}

/** The hover-revealed way into the call's details (the panel's opener). */
function InspectPill({ name, selected, onOpen }: { name: string; selected: boolean; onOpen: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className={css.inspectButton}
      data-selected={selected || undefined}
      aria-label={`查看 ${name} 调用详情`}
      onClick={onOpen}
    >
      <InspectIcon />
      详情
    </button>
  );
}