/**
 * The turn-process disclosure: one full-width row per turn that names what the
 * turn did and folds the turn's process rows (reasoning, tools, jobs) behind a
 * chevron when they exist.
 *
 * This row owns the transcript's ONE fold (W2). Before that the flow also
 * mounted a second disclosure inside the steps, so a reader who opened a turn
 * met another summary line to click and the two states could disagree. The
 * steps are now this row's business alone.
 *
 * Running and settled read as one string: the live row says what the turn is
 * doing WITH its elapsed time (`生成中，用时 4秒`), the settled one how long it
 * took (`用时 4秒`). The work summary rides beside it (see `workLabel` below).
 *
 * No shimmer band: the running cue is the words and the ticking duration. The
 * spoken form is a visually-hidden `role="status"` span carrying the stable
 * words only, because the duration changes every second.
 *
 * Collapse ownership lives with the caller (`flow.tsx` groups rows per turn);
 * this component renders the state it is handed. A live turn never reaches here
 * collapsible — the caller keeps it open.
 */
import { memo, useEffect, useState } from 'react';
import { liveDurationText } from '../format.js';
import { Button } from '../components/ui/button.js';
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
  /**
   * What the turn DID — the folded row's whole worth (`读取 3 个文件`,
   * `正在运行命令 · git status`). With the single fold (W2) this is the words a
   * collapsed turn shows, so the reader learns the work without opening
   * anything. Absent when the turn has no process to name.
   */
  summary?: string | undefined;
  /** The live variant of {@link summary}: the running activity, when the policy
   *  allows its detail. */
  liveTitle?: string | undefined;
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

/**
 * The row's work summary, or undefined when it should not print.
 *
 * With ONE fold (W2) the turn header is the only disclosure a turn carries, so
 * its collapsed form must say what the turn DID; the two states differ because
 * they answer different questions:
 *  - RUNNING: the activity is a STATUS (`正在运行命令 · git status`) — what is
 *    happening NOW. It stays visible with the steps open, because the open rows
 *    show what already happened while this names the current act.
 *  - SETTLED: the summary is the collapsed row's whole worth. Once the steps
 *    below are open they state the same thing in full, so printing it again
 *    would put one fact on the screen twice.
 * @param state - run state, fold state, and the two candidate labels.
 * @returns the summary to render, or undefined.
 */
export function workLabel(state: {
  running: boolean;
  open: boolean;
  summary?: string | undefined;
  liveTitle?: string | undefined;
}): string | undefined {
  const work = state.running ? state.liveTitle : state.summary;
  if (work === undefined || work === '') return undefined;
  if (state.running) return work;
  return state.open ? undefined : work;
}

export const TurnHeader = memo(function TurnHeader({
  label,
  running = false,
  startTs,
  summary,
  liveTitle,
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

  // The work summary's two jobs differ by run state: a RUNNING activity is a
  // status that stays visible with the steps open; a SETTLED summary is the
  // collapsed row's whole worth (see `workLabel`).
  const work = workLabel({ running, open, summary, liveTitle });
  return (
    <>
      {/* The spoken form is the stable words only: a live region over the
          ticking duration would announce every second. */}
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {label}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
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
        {work !== undefined && (
          <>
            <span className={css.sep} aria-hidden />
            <span className={css.work}>{work}</span>
          </>
        )}
        {collapsible && <ChevronDownGlyph14 className={css.chevron} />}
      </Button>
    </>
  );
});
