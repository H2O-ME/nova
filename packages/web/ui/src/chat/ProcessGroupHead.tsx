/**
 * The process group's own disclosure header — port of the harness `ui-chat`'s
 * `ProcessGroupHeader` seat in `ChatGroupSeat.tsx` (c) 2026 DeepSeek — MIT
 * License: one full-width row that names the group's work and folds the capped
 * step box under it.
 *
 * A closed group reads the SUMMARY (已读取文件并搜索代码… — what happened, no
 * counts); an open live group reads the running activity with its task detail
 * (正在运行命令 · git status) and shimmers while it runs — the reference's
 * `TextShimmer` seat. Live labels have no detail when the policy withholds it
 * (`liveProcessDetail`), and the label's minimum display time is not ported:
 * that seat guards against sub-perceptual title flicker in the harness's
 * 60fps store pipeline, while this row's words already change at tool-call
 * cadence, seconds apart.
 *
 * The reference leads with the activity's own icon and crossfades it into the
 * chevron; this port draws only the chevron — the glyph library carries no
 * per-activity set yet (recorded in docs/dsh-parity-inventory.md).
 */
import { memo } from 'react';
import { TextShimmer } from '../shell/TextShimmer.js';
import { ChevronDownGlyph14, ChevronUpGlyph14 } from './glyphs.js';
import css from './ProcessGroup.module.css';

export interface ProcessGroupHeadProps {
  /** The row's words: the summary, or the running title. */
  title: string;
  /** A live run: the title shimmers and the row never reads as settled. */
  live: boolean;
  /** The step box below is shown. */
  open: boolean;
  onToggle: () => void;
  /** Accessible name for the disclosure (the group's role, not its words). */
  label: string;
}

export const ProcessGroupHead = memo(function ProcessGroupHead({
  title,
  live,
  open,
  onToggle,
  label,
}: ProcessGroupHeadProps): JSX.Element {
  return (
    <button
      type="button"
      className={css.head}
      data-live={live || undefined}
      aria-expanded={open}
      aria-label={label}
      onClick={(event) => {
        // Keep focus on the row so a keyboard reader does not lose their place
        // when the disclosure collapses under them (the reference's own rule).
        event.currentTarget.focus();
        onToggle();
      }}
    >
      <span className={css.headChevron} aria-hidden>
        {open ? <ChevronUpGlyph14 /> : <ChevronDownGlyph14 />}
      </span>
      <TextShimmer active={live} className={css.headLabel}>{title}</TextShimmer>
    </button>
  );
});
