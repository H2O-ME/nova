/**
 * The New Session bar under the top seat: the reference's 32px nav row (`h-8`,
 * NewTaskButtonGroup.tsx:36) carrying its own label. One shape only — the
 * closed column has no narrow layout to fall back to (the reference's panel
 * fades out whole), so the label never needs a tooltip stand-in.
 */
import { SIDEBAR_COPY as COPY } from './view.js';
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
  onStartSession,
}: {
  onStartSession: () => void;
}): JSX.Element {
  const label = COPY['session.new.label'];
  return (
    <button
      type="button"
      className={css.newSession}
      aria-label={label}
      title={label}
      onClick={onStartSession}
    >
      <MessageCirclePlusIcon className={css.newSessionIcon} />
      <span className={css.newSessionLabel}>{COPY['session.new']}</span>
      {/* The reference's trailing hint — rendered only because the shell
          actually binds the shortcut (a hint for a dead key is a lie). */}
      <span className={css.newSessionHint}>{COPY['session.new.shortcut']}</span>
    </button>
  );
}