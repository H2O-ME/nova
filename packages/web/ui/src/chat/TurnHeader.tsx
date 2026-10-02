/**
 * The turn-process disclosure — port of the harness `ui-chat`'s
 * `TurnProcessNodeView.tsx` / `.module.css` (c) 2026 DeepSeek — MIT License:
 * one full-width 33px row per turn that names what the turn did and folds the
 * turn's process rows (reasoning, tools, jobs) behind a chevron when they
 * exist.
 *
 * Running and settled read as one string in the reference: the live row says
 * what the turn is doing WITH its elapsed time (`深度求索中，用时 4秒`), the
 * settled one how long it took (`用时 4秒`). This port keeps this product's
 * phase vocabulary for the doing-part and composes the same single string, so
 * the row has exactly the reference's shape: [label][chevron].
 *
 * The row paints no shimmer band — the reference animates disclosure TITLES
 * through `TextShimmer`, not this header, whose running cue is its words and
 * its ticking duration.
 *
 * Nothing else goes on this row. The reference's `.root` is label + chevron and
 * its sheet has no detail class at all: the per-run readings (clock, TTFT, TPS,
 * tool time) live in the session-stats pill's dialog and in the trajectory
 * table, NOT here. An earlier port printed them on a second line under the
 * header, which both duplicated the label's own 用时 and put a block of numbers
 * where the reference has nothing.
 *
 * The live/ticking announcement rides a visually-hidden `role="status"` span
 * (the reference's own accessibility seat): the duration changes every second,
 * so the row needs a stable spoken form rather than a live region over the
 * ticking text.
 *
 * Collapse ownership lives with the caller (the flow groups rows per turn);
 * this component only renders the state it is handed. Live, stopped, and
 * failed turns never reach here collapsible — the caller keeps them open,
 * the harness's `turnProcessAlwaysOpen` rule.
 */
import { memo, useEffect, useState } from 'react';
import { liveDurationText } from '../format.js';
import { ChevronDownGlyph14 } from './glyphs.js';
import a11yCss from './accessibility.module.css';
import css from './TurnHeader.module.css';

export interface TurnHeaderProps {
  /** What the turn is doing, or `用时 4秒` once settled. */
  label: string;
  /** The turn's run is in flight: the duration ticks and the row never collapses. */
  running?: boolean | undefined;
  /** When the turn started (the user block's ts); the live duration reads it. */
  startTs?: number | undefined;
  /** The turn has process rows to fold; without one the chevron is absent. */
  collapsible?: boolean | undefined;
  /** The process rows below are shown. */
  open?: boolean | undefined;
  /** The turn's own id and counts: the row's machine-readable hooks. */
  turnKey?: string | undefined;
  messageCount?: number | undefined;
  toolCallCount?: number | undefined;
  subagentCount?: number | undefined;
  /**
   * Receives this row's turn id. The callback rides in UNBOUND (the caller's
   * stable `onToggleTurn`), so this memo'd row skips a re-render for every
   * stream delta that does not concern it — a fresh closure here would defeat
   * exactly that.
   */
  onToggleTurn?: ((turnKey: string) => void) | undefined;
}

export const TurnHeader = memo(function TurnHeader({
  label,
  running = false,
  startTs,
  collapsible = false,
  open = false,
  turnKey,
  messageCount,
  toolCallCount,
  subagentCount,
  onToggleTurn,
}: TurnHeaderProps): JSX.Element {
  // The live clock ticks here, not in the reducer: elapsed time is the
  // viewer's clock, not session state (the harness runs the same interval).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { window.clearInterval(timer); };
  }, [running]);

  // One string, the reference's shape: the live row carries its own elapsed
  // time rather than a second box beside the label.
  const text = running && startTs !== undefined
    ? `${label}，用时${liveDurationText(now - startTs)}`
    : label;

  return (
    <>
      {/* The spoken form is the stable words only: a live region over the
          ticking duration would announce every second. */}
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {label}
      </span>
      <button
        type="button"
        className={css.root}
        data-open={open || undefined}
        data-running={running || undefined}
        data-turn-process={turnKey}
        data-turn-process-messages={messageCount}
        data-turn-process-tool-calls={toolCallCount}
        data-turn-process-subagents={subagentCount}
        disabled={!collapsible}
        aria-expanded={collapsible ? open : undefined}
        onClick={(event) => {
          // Keep focus on the row so a keyboard reader does not lose their
          // place when the disclosure collapses under them (the reference's
          // own rule).
          event.currentTarget.focus();
          if (turnKey !== undefined) onToggleTurn?.(turnKey);
        }}
      >
        <span className={css.label}>{text}</span>
        {collapsible && <ChevronDownGlyph14 className={css.chevron} />}
      </button>
    </>
  );
});
