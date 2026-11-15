/**
 * The New Session bar under the logo row. Expanded it is a 38px bar carrying
 * its own label; in the rail it is
 * the plain 36x36 icon control, and there the label has to come from a tooltip
 * (the reference passes `disabled={wide}` to the same primitive).
 */
import { Tooltip } from '../shell/Tooltip.js';
import { SIDEBAR_COPY as COPY } from './view.js';
import { cx } from '../composer/cx.js';
import css from './Sidebar.module.css';

/**
 * The row's glyph: the reference's `MessageCirclePlus` (a speech bubble with a
 * plus), redrawn on the shared 16-box/1.5-stroke grid. Local rather than in
 * `icons.tsx` because that sheet carries another session's uncommitted work —
 * adding to it would fold their diff into this batch's commit.
 */
function MessageCirclePlusIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* lucide `message-circle-plus`, scaled 24→16 (×2/3). */}
      <path d="M5.3 13.3A6 6 0 1 0 2.7 10.7L1.3 14.7Z" />
      <path d="M8 5.3v4.7M5.7 7.7h4.6" />
    </svg>
  );
}

export function NewSessionButton({
  wide,
  onStartSession,
}: {
  /** The wide layout (expanded, or still fading out of a live collapse). */
  wide: boolean;
  onStartSession: () => void;
}): JSX.Element {
  const label = COPY['session.new.label'];
  return (
    <Tooltip label={label} side="right" delayMs={500} disabled={wide}>
      <button
        type="button"
        className={css.newSession}
        aria-label={label}
        title={label}
        onClick={onStartSession}
      >
        <MessageCirclePlusIcon className={css.newSessionIcon} />
        {wide && <span className={cx(css.newSessionLabel, css.wide)}>{COPY['session.new']}</span>}
        {wide && (
          // The reference's trailing hint — rendered only because the shell
          // actually binds the shortcut (a hint for a dead key is a lie).
          <span className={css.newSessionHint}>{COPY['session.new.shortcut']}</span>
        )}
      </button>
    </Tooltip>
  );
}