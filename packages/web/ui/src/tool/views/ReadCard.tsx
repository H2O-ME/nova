/**
 * The read card: a file read as a line-numbered window. Ported from
 * deepseek-harness `ui-primitives/ReadBlock.tsx` + its stylesheet (MIT) — the
 * banner (path label, the `显示 X / Y 行` window note, copy), the fixed
 * line-number gutter, the head/tail height cap with its fold control.
 *
 * Two data-driven differences: the window's lines and their file numbers come
 * from our `read_file`'s own `[lines A-B of N]` header (`cards.readWindow`)
 * instead of a structured card field, and syntax highlighting is not ported —
 * this frontend ships no grammar engine (its markdown code blocks are plain
 * too).
 */
import { useState } from 'react';
import { headTailCap, foldLabels, readWindowNote, type ReadWindow } from '../cards.js';
import { COPY_LABELS, useCopy } from '../copy.js';
import css from './ReadCard.module.css';

/** Lines shown before the height cap collapses the middle (harness `CHAT_READ_MAX_LINES`). */
export const CHAT_READ_MAX_LINES = 8;

const LABELS = foldLabels('', '内容');

export interface ReadCardProps {
  /** The file the call read (the call card's operand). */
  path: string;
  /** The result's numbered window. */
  window: ReadWindow;
  /** The result said the window is a slice of a longer file. */
  truncated: boolean;
  /** Height cap in rows; `Infinity` disables it (the detail panel). */
  maxLines?: number;
}

export function ReadCard({ path, window, truncated, maxLines = CHAT_READ_MAX_LINES }: ReadCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const raw = window.lines.join('\n');
  const { copied, copy } = useCopy(raw);
  const { hidden, capped, headLines, tailLines } = headTailCap(window.lines.length, maxLines, expanded);
  const head = capped ? window.lines.slice(0, headLines) : window.lines;
  const tail = capped ? window.lines.slice(window.lines.length - tailLines) : [];
  // A read is a window when it is a slice of something larger: the tool said the
  // result was cut, or its header stated a total the returned lines do not reach.
  // A whole-file read has no larger thing to be a window of, so it gets no note.
  const windowed = truncated || (window.total !== null && window.lines.length < window.total);
  return (
    <div className={css.block}>
      <div className={css.banner}>
        <div className={css.label}>{path}</div>
        <div className={css.action}>
          {windowed && <span className={css.count}>{readWindowNote(window, truncated)}</span>}
          {/* An empty window omits Copy to avoid replacing the clipboard with nothing. */}
          {window.lines.length > 0 && (
            <button type="button" className={css.copyButton} onClick={copy}>
              {copied ? COPY_LABELS.copied : COPY_LABELS.copy}
            </button>
          )}
        </div>
      </div>
      {window.lines.length === 0 ? (
        <div className={css.empty}>（无内容）</div>
      ) : (
        <div className={css.body}>
          {head.map((line, index) => (
            <ReadLine key={index} number={window.offset + index} text={line} />
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
          {tail.map((line, index) => (
            <ReadLine key={`tail-${index}`} number={window.offset + window.lines.length - tailLines + index} text={line} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One numbered file line: the gutter is chrome, the content is the file. */
function ReadLine({ number, text }: { number: number; text: string }): JSX.Element {
  return (
    <div className={css.line}>
      <span className={css.gutter} aria-hidden>
        {number}
      </span>
      <span className={css.content}>{text}</span>
    </div>
  );
}