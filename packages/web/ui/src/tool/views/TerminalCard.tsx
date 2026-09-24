/**
 * The terminal card: how a shell call's expanded body reads. Ported from
 * deepseek-harness `ui-primitives/TerminalBlock.tsx` (MIT) — the banner (run-state
 * dot, prompt label, one row per command line, status pill, copy control), the
 * banner-pinned output scroller, and the "no output" placeholder.
 *
 * Two deliberate departures, both data-driven: the output is drawn plain (this
 * frontend ports no ANSI SGR parser, and the style guard forbids escape
 * sequences in its source), and a running card carries the call's live tail in
 * the output area, because our kernel streams one and the harness has no such
 * field (it renders a running command banner-only).
 */
import { contentLines, promptLabel } from '../cards.js';
import { COPY_LABELS, useCopy } from '../copy.js';
import { terminalDot, type BodyShell } from '../model.js';
import { StateDot } from '../StateDot.js';
import css from './TerminalCard.module.css';

type TerminalShell = Extract<BodyShell, { card: 'terminal' }>;

export interface TerminalCardProps {
  shell: TerminalShell;
  /** Session workspace root: the banner's prompt label (last segment). */
  cwd: string | undefined;
  /** Host account home, so a cwd equal to it collapses to `~`. */
  home: string | undefined;
  /** The row's summary, used as the command when the call card carried none. */
  collapsedSummary: string;
}

/** Run-state text for the dot's assistive-technology label (`terminal.*` copy). */
function runStateLabel(shell: TerminalShell): string {
  if (shell.running) return '运行中';
  return shell.exitCode === 0 ? '已完成' : '失败';
}

export function TerminalCard({ shell, cwd, home, collapsedSummary }: TerminalCardProps): JSX.Element {
  // A command's output ends with a newline; that terminator is not an extra
  // blank line to draw or to count against the height cap.
  const lines = contentLines(shell.output);
  const empty = lines.every((line) => line.trim() === '');
  // The raw output, never the rendered tree: the prompt line and the status pill
  // are chrome the user did not run.
  const { copied, copy } = useCopy(shell.output);
  const command = shell.command ?? collapsedSummary;
  // A multi-line command gets one prompt row per line, so a two-command shell
  // snippet reads as the two commands it is instead of collapsing into one
  // ellipsized row.
  const commandLines = contentLines(command);
  const dot = terminalDot(shell);
  // While running the card is banner-only (harness), except that a streamed tail
  // draws in the output area — our kernel reports one and the harness has no
  // such field.
  const showOutput = !shell.running || !empty;
  return (
    <div className={css.block} data-running={shell.running ? '' : undefined}>
      <div className={css.header}>
        <div className={css.prompt}>
          <span className={css.runStateLabel}>{runStateLabel(shell)}</span>
          {commandLines.map((line, index) => (
            <div key={index} className={css.promptLine}>
              {/* One dot for the card, on the first row: the exit status the
                  view carries is the whole call's. */}
              {index === 0 && <StateDot state={dot} className={css.runState} />}
              {/* The cwd labels the CALL, so only its first row carries it. */}
              <span className={css.cwd}>{index > 0 || cwd === undefined ? '$' : promptLabel(cwd, home)}</span>
              <span className={css.command}>{line}</span>
            </div>
          ))}
        </div>
        {shell.pill !== null && <span className={css.status}>{shell.pill}</span>}
        {!shell.running && !empty && (
          <button type="button" className={css.copyButton} onClick={copy}>
            {copied ? COPY_LABELS.copied : COPY_LABELS.copy}
          </button>
        )}
      </div>
      {showOutput &&
        (empty ? (
          <div className={css.empty}>无输出</div>
        ) : (
          <div className={css.output}>
            {lines.map((line, index) => (
              <div key={index} className={css.line}>
                {line}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}