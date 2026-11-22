/**
 * Assistant reasoning disclosure, independent of tool-call presentation: one
 * step row whose words name the work — 「正在思考」 while it streams, then
 * 「思考 持续了 N 秒」 once it lands. The raw text stays one click away in the
 * expanded body; the row itself never prints it.
 *
 * That last rule is the reference's (2026-11-15): its summary row carries the
 * label, the duration and the chevron and nothing else — a thought's first line
 * was a second, staler reading of what the expanded body already says, and on a
 * settled row it was the cleanest-looking line in the transcript while being the
 * least useful.
 *
 * The running label is announced through a visually-hidden span (the duration
 * ticks every second, so it cannot sit in a live region).
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

export interface ReasoningRowProps {
  /** Complete or streaming reasoning text. */
  text: string;
  /** Whether this block is the streaming tail. */
  running: boolean;
}

export const ReasoningRow = memo(function ReasoningRow({
  text,
  running,
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

  // The row's one line: the live verb while it streams, then the verb with the
  // measured duration. No preview — see the file header.
  const title = running
    ? RUNNING_LABEL
    : duration === null ? DONE_LABEL : `${DONE_LABEL} 持续了 ${duration} 秒`;

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
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
        /* The live verb sweeps while the model is still thinking — the
           reference's `animated-gradient-text` on「正在思考」, with its icon
           deliberately static (a spinner on every running row would spend the
           render budget on motion the sweep already carries). */
        running={running}
        onToggle={() => { interacted.current = true; setExpanded((value) => !value); }}
      >
        <div className={css.thinkBody} data-reasoning-body="">
          <MarkdownText text={text} streaming={running} variant="compact" />
        </div>
      </DisclosureRow>
    </div>
  );
});
