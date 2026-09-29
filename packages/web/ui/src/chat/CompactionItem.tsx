/**
 * Compaction marker — port of the harness `ui-chat`'s `CompactionItem.tsx`:
 * one dim 24px row (context glyph at rest → chevron on hover/focus), a
 * `title · summary` line, and the cited summary in a disclosure when the
 * current window still includes it. The row is deliberately not conversation
 * content: it marks where the model's history was folded.
 *
 * The harness reads its counts off the snapshot node; this surface's block
 * model has no compaction kind yet (compaction events currently arrive as hint
 * lines), so the props take the same three facts explicitly and the wire-up
 * can feed them the moment a block carries them.
 */
import { memo, useState } from 'react';
import { ChevronDownGlyph14, ChevronRightGlyph14, ContextGlyph14 } from './glyphs.js';
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
}

export const CompactionItem = memo(function CompactionItem({
  title,
  summary = null,
  shadowed = null,
  fallbackSummary = null,
}: CompactionItemProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const expandable = summary !== null;
  const open = expandable && expanded;
  const summaryLine = shadowed !== null
    ? `已压缩 ${String(shadowed.items)} 条历史记录（约 ${String(shadowed.tokens)} tokens）`
    : fallbackSummary ?? (expandable ? '点击查看压缩摘要' : '压缩摘要不可用');

  return (
    <div className={css.compactionRow}>
      <button
        type="button"
        className={css.compactionButton}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => { setExpanded((value) => !value); }}
      >
        <span className={css.compactionLeading} aria-hidden="true">
          <span className={css.compactionContextIcon} data-compaction-icon="context">
            <ContextGlyph14 />
          </span>
          <span
            className={css.compactionDisclosureIcon}
            data-compaction-disclosure={open ? 'expanded' : 'collapsed'}
          >
            {open ? <ChevronDownGlyph14 /> : <ChevronRightGlyph14 />}
          </span>
        </span>
        <span className={css.compactionTitle}>{title ?? '上下文已压缩'}</span>
        <span className={css.compactionSep} aria-hidden="true" />
        <span className={css.compactionSummary}>{summaryLine}</span>
      </button>
      {open && summary !== null && (
        <div className={css.compactionBody}>
          <MarkdownText text={summary} />
        </div>
      )}
    </div>
  );
});