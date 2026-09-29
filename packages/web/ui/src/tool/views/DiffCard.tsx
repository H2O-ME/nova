/**
 * The diff card: an applied file change, drawn inline. Ported from
 * deepseek-harness `ui-primitives/DiffBlock.tsx` + its stylesheet (MIT) — the
 * code-block surface and radius, the bold path header, the sign-prefixed
 * add/remove colors, the head/tail height cap with its fold control and the
 * `└ +A -R` footer.
 *
 * The rows come from our own `diff-lines.ts` (LCS-interleaved, long unchanged
 * runs collapsed to `⋯ n 行未变`), which is the one place this surface differs
 * from the harness by design: the harness prints the whole removed side, then
 * the whole added side. Path headers, signs, colors, cap and footer are the
 * harness's values.
 */
import { useState } from 'react';
import { headTailCap, diffCopyText, foldLabels, type DiffFile } from '../cards.js';
import { COPY_LABELS, useCopy } from '../copy.js';
import type { BodyShell } from '../model.js';
import css from './DiffCard.module.css';

type DiffShell = Extract<BodyShell, { card: 'diff' }>;

/** Rows shown before the height cap collapses the middle (harness `CHAT_DIFF_MAX_LINES`). */
export const CHAT_DIFF_MAX_LINES = 9;

const ROW_CLASS: Record<string, string | undefined> = {
  ctx: css.ctx,
  del: css.del,
  add: css.add,
  skip: css.skip,
};

const LABELS = foldLabels('差异', '差异');

export interface DiffCardProps {
  shell: DiffShell;
  /** Height cap in rows before the middle collapses; `Infinity` disables it (the detail panel). */
  maxLines?: number;
}

/** One flattened card row, so the height cap slices a single flat list. */
type CardRow = { path: string } | { row: DiffFile['rows'][number] };

export function DiffCard({ shell, maxLines = CHAT_DIFF_MAX_LINES }: DiffCardProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useCopy(diffCopyText(shell.files));
  const rows = flatten(shell.files);
  if (rows.length === 0) return null;
  const { hidden, capped, headLines, tailLines } = headTailCap(rows.length, maxLines, expanded);
  const head = capped ? rows.slice(0, headLines) : rows;
  const tail = capped ? rows.slice(rows.length - tailLines) : [];
  return (
    <div className={css.block}>
      <button type="button" className={css.copyButton} onClick={copy}>
        {copied ? COPY_LABELS.copied : COPY_LABELS.copy}
      </button>
      <div className={css.body}>
        {head.map((row, index) => (
          <CardLine key={index} row={row} />
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
        {tail.map((row, index) => (
          <CardLine key={`tail-${index}`} row={row} />
        ))}
      </div>
      <div className={css.footer}>
        └ +{shell.added} -{shell.removed} · {shell.files.length} 个文件
      </div>
    </div>
  );
}

/** The card's flat row list: a path header per file, then its change rows. */
function flatten(files: readonly DiffFile[]): CardRow[] {
  const rows: CardRow[] = [];
  for (const file of files) {
    rows.push({ path: file.path });
    for (const row of file.rows) rows.push({ row });
  }
  return rows;
}

/** One drawn row: a bold path header, a dim skip marker, or a signed line. */
function CardLine({ row }: { row: CardRow }): JSX.Element {
  if ('path' in row) return <div className={`${css.line} ${css.path}`}>{row.path}</div>;
  const kind = row.row.t;
  const body = kind === 'skip' ? `⋯ ${row.row.n} 行未变` : row.row.text;
  return <div className={`${css.line} ${ROW_CLASS[kind] ?? ''}`}>{body}</div>;
}