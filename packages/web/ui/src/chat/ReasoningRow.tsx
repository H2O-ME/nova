/**
 * Assistant reasoning disclosure, independent of tool-call presentation —
 * port of the harness `ui-chat`'s `ReasoningRow.tsx`: one 24px Think row
 * (`思考`, the latest line while it streams, the first line once it settles,
 * `**` markers stripped) with a hover chevron preview, the running sweep band,
 * and the full text in the expanded body.
 *
 * Text comes from the surface (the harness reads it from its locale seat); the
 * running label is announced through the visually-hidden span the harness uses.
 */
import { useState } from 'react';
import { DisclosureRow } from './DisclosureRow.js';
import { ThinkGlyph14 } from './glyphs.js';
import a11yCss from './accessibility.module.css';
import css from './ReasoningRow.module.css';

/** The collapsed row shows the stream's tail: the reader follows the thought. */
function latestLine(text: string): string {
  const visible = text.trimEnd();
  const newline = visible.lastIndexOf('\n');
  return newline === -1 ? visible : visible.slice(newline + 1);
}

/** A settled block shows its opening line, not its last. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
}

export interface ReasoningRowProps {
  /** Complete or streaming reasoning text. */
  text: string;
  /** Whether this block is the streaming tail. */
  running: boolean;
}

export function ReasoningRow({ text, running }: ReasoningRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const summary = (running ? latestLine(text) : firstLine(text)).replaceAll('**', '');

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
    >
      {running && <span className={a11yCss.visuallyHidden}>思考中</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<ThinkGlyph14 />}
        title="思考"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded((value) => !value); }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden="true" />
            <span className={css.summary} data-follow-end={running || undefined}>
              <span className={css.summaryText}>{summary}</span>
            </span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  );
}