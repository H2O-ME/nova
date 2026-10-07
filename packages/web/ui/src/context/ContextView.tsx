/**
 * The 上下文 pane's frame: the column, the refresh-on-mount, the empty case. The
 * cards live in their own files and every figure comes from the pure models
 * beside them, so the panel and the host's fold cannot disagree.
 *
 * **Scrolling belongs to the SHARED scrollport** (see `scrollportOf`): a nested
 * scroller whose content fits its box has no range and its `overscroll-behavior:
 * contain` swallows the wheel instead of chaining it — that is how the pane
 * froze. On mount the port is re-anchored at this pane's top, because the
 * transcript left it at the transcript's bottom.
 */
import { useEffect, useRef } from 'react';
import type { ContextTimeline } from '../types.js';
import type { SessionTotals } from '../../../src/totals.js';
import { scrollportOf } from '../scroll-follow.js';
import { CompositionCard, StatsStrip } from './ContextCards.js';
import { DashboardCard } from './DashboardCard.js';
import { DnaCard } from './DnaCard.js';
import { ElementCard } from './ElementCard.js';
import { EventsCard } from './EventsCard.js';
import { FilesCard } from './FileCard.js';
import { TimingCard } from './TimingCard.js';
import { TokenStatsCard } from './TokenStatsCard.js';
import { TrendCard } from './TrendCard.js';
import css from './ContextView.module.css';

export interface ContextViewProps {
  /** The fold's reading; null when the plugin is off (the pane is unmounted then). */
  timeline: ContextTimeline | null;
  /** The model's window, from the SAME reading the composer's ring uses. */
  window?: number;
  /** Absolute path of the open session log — the DNA card fetches a window by seq. */
  sessionFile?: string;
  /**
   * The session's cumulative run numbers — the SAME object the composer's usage
   * pill reads, so the Token 统计 card's total is the pill's figure by
   * construction rather than a second fold of the same events.
   */
  totals: SessionTotals;
  /** Ask the host for a fresh reading (the pane's refresh and open path). */
  onRefresh: () => void;
}

export function ContextView({ timeline, window, sessionFile, totals, onRefresh }: ContextViewProps): JSX.Element {
  const root = useRef<HTMLDivElement | null>(null);
  // Read on mount: opening the view is the request, and re-mounting (switching
  // back to this tab) re-reads so the pane is never a stale snapshot.
  useEffect(() => { onRefresh(); }, [onRefresh]);
  // The pane opens at its own head (the headline): the shared scrollport is where
  // the transcript left it, and the chat re-pins itself when it mounts again —
  // see the header.
  useEffect(() => {
    if (root.current !== null) scrollportOf(root.current).scrollTop = 0;
  }, []);
  return (
    <div className={css.root} ref={root} data-context-view="">
      <div className={css.column}>
        {timeline === null ? (
          // Defensive: the reducer normally drops the tab first. Render the
          // empty column so a mount in this state never flashes a broken pane.
          <p className={css.empty}>上下文插件未开启。</p>
        ) : (
          <>
            <div className={css.headRow}>
              <StatsStrip timeline={timeline} />
              <TokenStatsCard timeline={timeline} totals={totals} />
            </div>
            <DashboardCard />
            <CompositionCard timeline={timeline} {...(window !== undefined ? { window } : {})} />
            <TrendCard
              points={timeline.points}
              truncated={timeline.truncated}
              {...(window !== undefined ? { window } : {})}
            />
            <TimingCard points={timeline.points} />
            <DnaCard points={timeline.points} {...(sessionFile !== undefined ? { sessionFile } : {})} />
            <ElementCard timeline={timeline} />
            <EventsCard timeline={timeline} />
            <FilesCard files={timeline.files} />
          </>
        )}
      </div>
    </div>
  );
}
