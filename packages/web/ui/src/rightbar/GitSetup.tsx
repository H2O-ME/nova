/**
 * The 变更 page's not-a-repository empty state: the reference's 源代码管理 card.
 *
 * The workspace having no git repo is not a dead end the page shrugs at — it
 * is the one state with its own offers, and both must be real: 打开文件夹
 * reuses the workspace picker the hero already owns (the host opens the OS
 * dialog), and 克隆仓库 turns the card into a URL form whose answer is the
 * HOST cloning and then OPENING the clone (the re-stated `ready`), so the
 * panel lands on the new repository without a second gesture.
 */
import { useState } from 'react';
import type { ClientFrame } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';
import css from './GitSetup.module.css';

export function GitSetup({
  connected,
  clonePending,
  onOpenWorkspace,
  send,
}: {
  connected: boolean;
  clonePending: boolean | undefined;
  onOpenWorkspace: (() => void) | undefined;
  send: (frame: ClientFrame) => void;
}): JSX.Element {
  const [cloning, setCloning] = useState(false);
  const [url, setUrl] = useState('');
  const submit = (): void => {
    const trimmed = url.trim();
    if (trimmed === '' || !connected || clonePending === true) return;
    send({ type: 'git_clone', url: trimmed });
  };
  return (
    <div className={css.setup}>
      <div className={css.setupTitle}>{RIGHTBAR_COPY['git.setup.title']}</div>
      <p className={css.setupBody}>{RIGHTBAR_COPY['git.setup.body']}</p>
      {cloning ? (
        <form
          className={css.cloneForm}
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <input
            className={css.cloneUrl}
            value={url}
            placeholder={RIGHTBAR_COPY['git.clone.placeholder']}
            aria-label={RIGHTBAR_COPY['git.clone.placeholder']}
            autoFocus
            onChange={(event) => { setUrl(event.target.value); }}
          />
          <div className={css.setupActions}>
            <button type="submit" className={css.setupPrimary} disabled={!connected || clonePending === true || url.trim() === ''}>
              {clonePending === true ? RIGHTBAR_COPY['git.clone.running'] : RIGHTBAR_COPY['git.clone.run']}
            </button>
            <button
              type="button"
              className={css.setupButton}
              onClick={() => { setCloning(false); setUrl(''); }}
            >
              {RIGHTBAR_COPY['git.clone.cancel']}
            </button>
          </div>
        </form>
      ) : (
        <div className={css.setupActions}>
          {onOpenWorkspace !== undefined && (
            <button type="button" className={css.setupButton} onClick={onOpenWorkspace}>
              {RIGHTBAR_COPY['git.setup.open']}
            </button>
          )}
          <button type="button" className={css.setupButton} onClick={() => { setCloning(true); }}>
            {RIGHTBAR_COPY['git.setup.clone']}
          </button>
        </div>
      )}
    </div>
  );
}
