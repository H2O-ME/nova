/**
 * The New Session bar under the logo row.
 * Ported from deepseek-harness `ui-sidebar/src/client/SidebarRoot.tsx` (the
 * `.newSession` button) + `SidebarRoot.module.css` (c) 2026 DeepSeek — MIT
 * License. Expanded it is a 38px bar carrying its own label; in the rail it is
 * the plain 36x36 icon control.
 */
import { PlusIcon } from '../icons.js';
import { SIDEBAR_COPY as COPY, cls } from './view.js';
import css from './Sidebar.module.css';

export function NewSessionButton({
  wide,
  onStartSession,
}: {
  /** The wide layout (expanded, or still fading out of a live collapse). */
  wide: boolean;
  onStartSession: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={css.newSession}
      aria-label={COPY['session.new.label']}
      title={COPY['session.new.label']}
      onClick={onStartSession}
    >
      <PlusIcon className={css.newSessionIcon} />
      {wide && <span className={cls(css.newSessionLabel, css.wide)}>{COPY['session.new']}</span>}
    </button>
  );
}