/**
 * The search card: grep matches grouped by file (or glob paths), drawn inline.
 * Ported from deepseek-harness `ui-primitives/SearchBlock.tsx` + its stylesheet
 * (MIT) — the banner summary, per-file collapse, the head/tail height cap (with
 * the tail's restored file header, so a row below the cut stays attributable)
 * and the copy control.
 *
 * Data note: `SearchResultView.matches` carries locations only, so the matched
 * text arrives through `cards.matchTexts`, a stopgap parse of the tool's own
 * `path:line: text` result format. When the card view grows a `text` field per
 * match, that parse goes away.
 */
import { useState } from 'react';
import { headTailCap, foldLabels, searchCopyText, searchSummary } from '../cards.js';
import { COPY_LABELS, useCopy } from '../copy.js';
import type { BodyShell } from '../model.js';
import css from './SearchCard.module.css';

type SearchShell = Extract<BodyShell, { card: 'search' }>;

/** Rows shown before the height cap collapses the middle (harness `CHAT_SEARCH_MAX_LINES`). */
export const CHAT_SEARCH_MAX_LINES = 8;

const LABELS = foldLabels('', '结果');

export interface SearchCardProps {
  shell: SearchShell;
  /** Height cap in rows; `Infinity` disables it (the detail panel). */
  maxLines?: number;
}

/**
 * One flattened render row. A matches card produces a `file` header row per
 * group followed by a `match` row per retained line while the group is expanded;
 * a name-mode card produces one `path` row per group. The height cap counts
 * these rows uniformly.
 */
type SearchRow =
  | { type: 'file'; path: string; count: number; index: number; collapsed: boolean }
  | { type: 'match'; lineNumber: number; text: string; key: string; fileIndex: number }
  | { type: 'path'; path: string };

function toRows(shell: SearchShell, collapsed: ReadonlySet<number>): SearchRow[] {
  if (shell.mode === 'name') return shell.groups.map((group): SearchRow => ({ type: 'path', path: group.path }));
  const rows: SearchRow[] = [];
  shell.groups.forEach((group, index) => {
    const isCollapsed = collapsed.has(index);
    rows.push({ type: 'file', path: group.path, count: group.lines.length, index, collapsed: isCollapsed });
    if (isCollapsed) return;
    for (const line of group.lines) {
      rows.push({
        type: 'match',
        lineNumber: line,
        text: shell.texts.get(`${group.path}:${line}`) ?? '',
        key: `${index}:${line}`,
        fileIndex: index,
      });
    }
  });
  return rows;
}

function rowKey(row: SearchRow): string {
  switch (row.type) {
    case 'match':
      return `match:${row.key}`;
    case 'file':
      return `file:${row.index}`;
    case 'path':
      return `path:${row.path}`;
  }
}

export function SearchCard({ shell, maxLines = CHAT_SEARCH_MAX_LINES }: SearchCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());
  const { copied, copy } = useCopy(searchCopyText(shell.groups, shell.texts));
  const rows = toRows(shell, collapsed);
  const { hidden, capped, headLines, tailLines } = headTailCap(rows.length, maxLines, expanded);
  const head = capped ? rows.slice(0, headLines) : rows;
  const naturalTail = capped ? rows.slice(rows.length - tailLines) : [];
  // When the tail slice begins inside a file's matches, its own header sits
  // above the cut and is not shown, so those rows could not be attributed to a
  // file. Restore the owning header at the top of the tail — unless the head
  // slice already carries it, where it would duplicate.
  const tailLead = naturalTail[0];
  const tailHeader =
    tailLead?.type === 'match' && !head.some((row) => row.type === 'file' && row.index === tailLead.fileIndex)
      ? rows.find((row): row is Extract<SearchRow, { type: 'file' }> => row.type === 'file' && row.index === tailLead.fileIndex)
      : undefined;
  // The restored header is itself a row: it consumes a tail slot so visible rows
  // hold at maxLines and `hidden` stays exact.
  const tail = tailHeader === undefined ? naturalTail : naturalTail.slice(1);
  const toggleFile = (index: number): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  return (
    <div className={css.block}>
      <div className={css.header}>
        <span className={css.summary}>
          {searchSummary({
            mode: shell.mode,
            shown: shell.shown,
            total: shell.total,
            files: shell.groups.length,
            truncated: shell.truncated,
          })}
        </span>
        {rows.length > 0 && (
          <button type="button" className={css.copyButton} onClick={copy}>
            {copied ? COPY_LABELS.copied : COPY_LABELS.copy}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className={css.empty}>无结果</div>
      ) : (
        <div className={css.body}>
          {head.map((row) => (
            <div key={rowKey(row)}>
              <SearchLine row={row} onToggle={toggleFile} />
            </div>
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
          {tailHeader !== undefined && (
            <div key={`tailHeader:${rowKey(tailHeader)}`}>
              <SearchLine row={tailHeader} onToggle={toggleFile} />
            </div>
          )}
          {tail.map((row) => (
            <div key={`tail:${rowKey(row)}`}>
              <SearchLine row={row} onToggle={toggleFile} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One flattened row: a path, a collapsible file header, or a numbered match. */
function SearchLine({ row, onToggle }: { row: SearchRow; onToggle: (index: number) => void }): JSX.Element {
  if (row.type === 'path') return <div className={css.line}>{row.path}</div>;
  if (row.type === 'match') {
    return (
      <div className={css.line}>
        <span className={css.lineNumber}>{row.lineNumber}: </span>
        {row.text}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={css.fileHeader}
      aria-expanded={!row.collapsed}
      onClick={() => onToggle(row.index)}
    >
      <span className={css.filePath}>{row.path}</span>
      <span className={css.fileCount}>{row.count}</span>
    </button>
  );
}