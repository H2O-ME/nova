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
 * state shimmers the row's own text through {@link TextShimmer} — the harness
 * paints no overlay band, so neither does this row. Expanding draws the
 * card's own body — a terminal banner, a real diff, numbered read lines, a
 * grouped search, a plan list — or the IN/OUT card for a card-less call. The
 * expanded body is the call's ONLY way of being read: the separate detail
 * column is gone (the right column belongs to the panel pages alone).
 */
import { memo, useMemo, useState, type KeyboardEvent } from 'react';
import { toolCardModel, type CardModel } from '../card-view.js';
import { ChevronDownIcon, ChevronUpIcon } from '../icons.js';
import { BashIcon, BrowseIcon, ChecklistIcon, EditIcon, SearchToolIcon, ToolIcon } from './icons.js';
import { bodyShell, rowDot, rowSlots, rowStatusLabel, rowVariant, type RowSlots, type RowVariant } from './model.js';
import { StateDot } from './StateDot.js';
import { TextShimmer } from '../shell/TextShimmer.js';
import { CardBody } from './views/CardBody.js';
import type { ToolCallView, ToolResultView } from '../types.js';
import css from './ToolRow.module.css';

export interface ToolRowProps {
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
  /** Flow identity for prepend re-anchoring. */
  anchorKey: string;
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
  name,
  args,
  view,
  result,
  output,
  tail,
  idle,
  anchorKey,
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
    ? <ChevronUpIcon className={css.chevron} />
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
  // The running treatment is the harness's own: the title and the summary
  // sweep through their glyphs (TextShimmer), so the row never grows an
  // overlay band. `state === 'running'` is the same fact the sweep used.
  const running = state === 'running';
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
      <TextShimmer active={running} className={css.title}>{slots.title}</TextShimmer>
      {slots.summary !== '' && (
        <>
          <span className={css.sep} aria-hidden />
          {/* The mono flag rides the wrapper: TextShimmer owns the inner span,
              so the row's code-font rule reads the attribute here. */}
          <span className={css.summaryWrap} data-mono={slots.mono || undefined}>
            <TextShimmer active={running} className={summaryClass(state)}>{slots.summary}</TextShimmer>
          </span>
          {slots.suffix !== null && (
            <TextShimmer active={running} className={suffixClass(slots)}>{slots.suffix}</TextShimmer>
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

/**
 * The summary's class set: a failure's own line takes the error tone and an
 * interrupted call the warning tone (harness `.errorSummary` / `.stoppedSummary`).
 * Both are excluded from the row's hover lift, so the verdict color survives the
 * pointer passing over.
 */
function summaryClass(state: CardModel['state']): string {
  const base = css.summary ?? '';
  const extra = state === 'fail' ? css.errorSummary : state === 'stale' ? css.stoppedSummary : undefined;
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