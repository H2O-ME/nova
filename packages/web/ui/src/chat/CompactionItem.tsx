/**
 * Compaction marker: the reference's DIVIDER row, not a disclosure line with a
 * chevron at rest (2026-11-15, ZCode alignment).
 *
 * The reference draws a boundary as one centred label between two hairlines —
 * `flex w-full items-center gap-3 px-4 py-2 text-ui-base text-foreground-subtle`
 * with `h-px min-w-8 flex-1 bg-border/50` on both sides
 * (`v4/ConversationShareReadonlyTimeline.tsx:264-440`) — because the row is not
 * a thing to open; it marks WHERE the model's history was folded. Nova drew a
 * 24px chevron row, so a boundary read as another tool call.
 *
 * The summary stays one click away: the label is the trigger when the window
 * still carries the summary text.
 *
 * While a compaction is in flight the label sweeps (the reference's
 * `animated-gradient-text font-medium` on its running state) and the icon is
 * omitted — the sweep is the progress signal.
 */
import { memo, useState } from 'react';
import { ContextGlyph14 } from './glyphs.js';
import { TextShimmer } from '../shell/TextShimmer.js';
import { MarkdownText } from './markdown/MarkdownText.js';
import css from './MessageItem.module.css';

export interface CompactionItemProps {
  /** Marker title; the harness defaults it to its locale's label. */
  title?: string | undefined;
  /** The summary the window still includes; null = not expandable. */
  summary?: string | null | undefined;
  /** What the compaction shadowed (items + tokens), when the host reports it. */
  shadowed?: { items: number; tokens: number } | null | undefined;
  /** Settlement text used when the structured counts are unavailable. */
  fallbackSummary?: string | null | undefined;
  /** A compaction is running right now (the label sweeps, the icon hides). */
  running?: boolean | undefined;
}

export const CompactionItem = memo(function CompactionItem({
  title,
  summary = null,
  shadowed = null,
  fallbackSummary = null,
  running = false,
}: CompactionItemProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const expandable = summary !== null;
  const open = expandable && expanded;
  const summaryLine = shadowed !== null
    ? `已压缩 ${String(shadowed.items)} 条历史记录（约 ${String(shadowed.tokens)} tokens）`
    : fallbackSummary ?? (expandable ? '点击查看压缩摘要' : '压缩摘要不可用');
  const label = title ?? (running ? '正在压缩上下文' : '上下文已压缩');

  const text = (
    <>
      {!running && (
        <span className={css.markerIcon} aria-hidden="true">
          <ContextGlyph14 />
        </span>
      )}
      <TextShimmer active={running} className={css.markerText}>{label}</TextShimmer>
      <span className={css.markerSummary}>{summaryLine}</span>
    </>
  );

  return (
    <div className={css.marker} data-marker="compaction" data-running={running || undefined}>
      <span className={css.markerRule} aria-hidden="true" />
      {expandable ? (
        <button
          type="button"
          className={css.markerLabel}
          aria-expanded={open}
          onClick={() => { setExpanded((value) => !value); }}
        >
          {text}
        </button>
      ) : (
        <span className={css.markerLabel}>{text}</span>
      )}
      <span className={css.markerRule} aria-hidden="true" />
      {open && summary !== null && (
        <div className={css.markerBody}>
          <MarkdownText text={summary} />
        </div>
      )}
    </div>
  );
});
