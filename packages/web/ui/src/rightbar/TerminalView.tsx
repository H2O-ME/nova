/**
 * 终端: a real terminal, docked.
 *
 * The host keeps ONE pty per session (`web/src/term-session.ts`); this page is
 * a real terminal EMULATOR (xterm.js) fed by the pty's raw byte stream. Keystrokes
 * go back verbatim, `cd`/jobs/`vim`/Ctrl-C all work because the shell believes
 * it owns a terminal — which it does now.
 *
 * The shell it starts in is the reader's choice: the host discovers what is
 * installed (`discover_shells` → the `shells` state), the picker below asks for
 * one by path, and the choice is remembered per browser
 * (`terminal-shell.ts`, dsh's own preference shape). A running terminal is
 * respawned when the reader picks a different shell — a picker that left the
 * old process in front would lie.
 */
import { useEffect, useRef, useState } from 'react';
import type { ClientFrame, WireShell } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';
import { termStatusWord, type TermState } from './terminal-model.js';
import { readShellPreference, requestedShell, writeShellPreference } from './terminal-shell.js';
import { RefreshGlyph } from './panel-icons.js';
import { useTerminalEmulator } from './use-terminal.js';
import { IconButton, Notice } from './kit.js';
import css from './TerminalView.module.css';

export interface TerminalViewProps {
  term: TermState;
  /** The session's workspace root — where the pty starts. */
  rootDir: string;
  connected: boolean;
  send: (frame: ClientFrame) => void;
  /** The host's discovered shells (null until the first answer). */
  shells: { items: readonly WireShell[]; current: string } | null;
}

export function TerminalView({ term, rootDir, connected, send, shells }: TerminalViewProps): JSX.Element {
  const { hostRef, api, ready, loadError, sendRef } = useTerminalEmulator();
  sendRef.current = send;
  const feed = term.feed;
  const feedSeen = useRef(0);
  const session = term.session;
  // Bumped when the reader picks a different shell, so the open effect asks
  // again — and after a kill, the host spawns the NEW shell rather than
  // reporting the old process's exit.
  const [shellEpoch, setShellEpoch] = useState(0);

  // The shell inventory is asked for by THIS page: opening the tab is enough to
  // populate the picker (the answer rides one frame; there is no other reader).
  const shellsMissing = shells === null;
  useEffect(() => {
    if (!connected || !shellsMissing) return;
    sendRef.current({ type: 'discover_shells' });
  }, [connected, shellsMissing, sendRef]);

  // The path the open carries: the remembered choice while the host still
  // lists it, else the host's own default.
  const shellPath = shells === null ? undefined : requestedShell(shells.items, shells.current, readShellPreference());

  // Open/reattach once the emulator exists: the host answers with the whole
  // retained scrollback (reset), so the screen rebuilds from the pty's own
  // bytes. The initial grid rides the open so the pty is born at the right size.
  useEffect(() => {
    const instance = api.current;
    if (!ready || !connected || instance === null) return;
    const { cols, rows } = instance.grid();
    sendRef.current({ type: 'term_open', cols, rows, ...(shellPath !== undefined ? { shell: shellPath } : {}) });
    // Switching into the terminal tab is a "I want to type here" gesture.
    instance.focus();
  }, [ready, connected, api, session, rootDir, shellPath, shellEpoch, sendRef]);

  // Consume owed output batches in order, and only once: the effect re-runs on
  // any dependency change (the emulator's own mount, say), and replaying bytes
  // xterm already ate would duplicate the screen. The ref is advanced FIRST — a
  // write that throws must not make the next paint eat them again.
  useEffect(() => {
    const instance = api.current;
    if (instance === null || feed === null || feed.seq === feedSeen.current) return;
    feedSeen.current = feed.seq;
    if (feed.reset) instance.reset();
    if (feed.data.length > 0) instance.write(feed.data);
  }, [api, feed, ready]);

  const respawn = (): void => {
    // Kill-then-open: ONE respawn rule lives on the host (an exited pty is
    // never silently replaced), so the gesture is explicit about both halves.
    const instance = api.current;
    send({ type: 'term_kill' });
    const grid = instance?.grid() ?? { cols: 80, rows: 24 };
    send({ type: 'term_open', cols: grid.cols, rows: grid.rows, ...(shellPath !== undefined ? { shell: shellPath } : {}) });
    instance?.focus();
  };

  const pickShell = (path: string): void => {
    if (path === shellPath) return;
    writeShellPreference(path);
    // A running terminal does not become the picked shell by wishing: the
    // switch is an explicit respawn (the strip's own restart, aimed by the
    // picker). An un-opened terminal just re-aims the next open.
    if (term.status === 'running') send({ type: 'term_kill' });
    setShellEpoch((epoch) => epoch + 1);
  };

  return (
    <div className={css.view}>
      {rootDir === '' ? (
        <Notice kind="empty">{RIGHTBAR_COPY['files.noWorkspace']}</Notice>
      ) : loadError !== null ? (
        <Notice kind="error">{RIGHTBAR_COPY['term.loadfailed'].replace('{message}', loadError)}</Notice>
      ) : (
        <div className={css.screen} data-term-screen="" ref={hostRef} onClick={() => { api.current?.focus(); }} />
      )}
      {term.error !== undefined && (
        <div className={css.error} role="alert">{term.error}</div>
      )}
      <footer className={css.footer}>
        <span className={css.status} role="status" data-status={term.status}>{termStatusWord(term)}</span>
        {shells !== null && shells.items.length > 0 && (
          <label className={css.shellPick}>
            <span className={css.shellLabel}>{RIGHTBAR_COPY['term.shell']}</span>
            <select
              className={css.shellSelect}
              value={shellPath ?? shells.current}
              aria-label={RIGHTBAR_COPY['term.shell']}
              onChange={(event) => { pickShell(event.target.value); }}
            >
              {shells.items.map((shell) => (
                <option key={shell.path} value={shell.path}>{shell.name}</option>
              ))}
            </select>
          </label>
        )}
        <IconButton label={RIGHTBAR_COPY['term.restart']} size="sm" disabled={!connected || rootDir === ''} onClick={respawn}>
          <RefreshGlyph />
        </IconButton>
      </footer>
    </div>
  );
}
