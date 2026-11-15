/**
 * Assistant reasoning disclosure, independent of tool-call presentation: one
 * 24px step row whose words come from the harness's step-process vocabulary
 * (`locale.ts`
 * `message.stepProcess.thinking` / `.done.thinking`): a streaming block reads
 * 「正在分析请求」 plus the thought's live tail, a settled one reads
 * 「已完成分析」 — the work is named, and the raw text stays one click away in
 * the expanded body rather than standing in as the row's title.
 *
 * The running label is announced through the visually-hidden span the harness
 * uses; the settled row's title carries the completion on its own.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { DisclosureRow } from './DisclosureRow.js';
import { ThinkGlyph14 } from './glyphs.js';
import { MarkdownText } from './markdown/MarkdownText.js';
import a11yCss from './accessibility.module.css';
import css from './ReasoningRow.module.css';

/** The streaming row's title (the reference's `chat.reasoning.thinking`). */
const RUNNING_LABEL = '正在思考';
/** The settled row's title (the reference's `chat.reasoning.thought`). */
const DONE_LABEL = '思考';

/** The settled row's preview: the thought's first line. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
}

/**
 * The streaming row's preview: the first line of the last COMPLETED paragraph.
 * A half-typed line must not stand in as the row's summary, so the scan only
 * accepts a paragraph whose newline has already arrived.
 */
function latestCompletedParagraphFirstLine(text: string): string {
  let summary = '';
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  while (true) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd = nextParagraph === null
      ? text.length
      : nextParagraph.index + nextParagraph[0].indexOf('\n');
    const newline = text.indexOf('\n', paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== '') summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

export interface ReasoningRowProps {
  /** Complete or streaming reasoning text. */
  text: string;
  /** Whether this block is the streaming tail. */
  running: boolean;
  /** The work-details policy's `settledReasoningPreview`: the 简洁 mode
   *  withholds the summary, so the row reads as the bare title. */
  previewAllowed?: boolean | undefined;
}

export const ReasoningRow = memo(function ReasoningRow({
  text,
  running,
  previewAllowed = true,
}: ReasoningRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // The reference shows how long the model thought (`chat.reasoning.duration*`):
  // the settled row reads 「思考 12 秒」. The clock starts on the first streaming
  // frame and stops when the block settles.
  const startedAt = useRef<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    if (running) {
      startedAt.current ??= Date.now();
      return;
    }
    const started = startedAt.current;
    if (started === null) return;
    startedAt.current = null;
    setDuration(Math.max(1, Math.ceil((Date.now() - started) / 1000)));
  }, [running]);
  // Auto-collapse on settle: a row the reader opened while it streamed folds
  // back once the thought lands, unless they folded it themselves (the
  // reference's `autoCollapseKey` rule reads the same).
  const interacted = useRef(false);
  useEffect(() => {
    if (!running && !interacted.current) setExpanded(false);
  }, [running]);

  // The harness's summary source: while streaming it is the last completed
  // paragraph's first line (a half-written line is not a summary), once
  // settled the text's own first line. The policy's gate names SETTLED rows —
  // a streaming row's live tail is the progress being watched, not a summary.
  const summaryText = running ? latestCompletedParagraphFirstLine(text) : firstLine(text);
  const summary = summaryText.replaceAll('**', '');
  const preview = !expanded && summary !== '' && (running || previewAllowed);
  const title = running
    ? RUNNING_LABEL
    : duration === null ? DONE_LABEL : `${DONE_LABEL} 持续了 ${duration} 秒`;

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
      data-preview={preview || undefined}
    >
      {running && <span className={a11yCss.visuallyHidden}>{RUNNING_LABEL}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<ThinkGlyph14 />}
        title={title}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { interacted.current = true; setExpanded((value) => !value); }}
        collapsedContent={preview ? (
          <>
            <span className={css.separator} aria-hidden="true" />
            <span className={css.summary} data-streaming={running || undefined}>
              <span className={css.summaryText}>{summary}</span>
            </span>
          </>
        ) : undefined}
      >
        <div className={css.thinkBody}>
          <MarkdownText text={text} streaming={running} variant="compact" />
        </div>
      </DisclosureRow>
    </div>
  );
});
