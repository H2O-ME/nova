/**
 * 终端: a real terminal, docked.
 *
 * The host keeps ONE pty per session (`web/src/term-session.ts`); this page is
 * a real terminal EMULATOR (xterm.js) fed by the pty's raw byte stream. Keystrokes
 * go back verbatim, `cd`/jobs/`vim`/Ctrl-C all work because the shell believes
 * it owns a terminal — which it does now.
 *
 * The shell it starts in is the reader's choice, made on the start page's
 * terminal card (the reference's `TerminalGuide`: the card opens the tab, the
 * chevron beside its title opens the shell menu). The choice is remembered per
 * browser (`terminal-shell.ts`), and picking a DIFFERENT shell while one runs
 * respawns it — a picker that left the old process in front would lie; the
 * pick arrives here as a `pick` epoch, and the open effect re-aims.
 *
 * The status band follows the reference: it exists only when the terminal has
 * something to SAY (loading, an exit, a refusal) — a running terminal is just
 * its screen, and the band carries the way back in (a 新建终端 primary on an
 * ended terminal, a retry on a refused spawn).
 */
import { useEffect, useRef } from 'react';
import type { ClientFrame, WireShell } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';
import { termStatusWord, type TermState } from './terminal-model.js';
import { readShellPreference, terminalOpenFrame } from './terminal-shell.js';
import { RefreshGlyph } from './panel-icons.js';
import { useTerminalEmulator } from './use-terminal.js';
import { Notice } from './kit.js';
import css from './TerminalView.module.css';

export interface TerminalViewProps {
  term: TermState;
  /** The session's workspace root — where the pty starts. */
  rootDir: string;
  connected: boolean;
  send: (frame: ClientFrame) => void;
  /** The host's discovered shells (null until the first answer). */
  shells: { items: readonly WireShell[]; current: string } | null;
  /** Bumped when the reader picks a shell on the start page (the respawn trigger). */
  pick: number;
}

export function TerminalView({ term, rootDir, connected, send, shells, pick }: TerminalViewProps): JSX.Element {
  const { hostRef, api, ready, loadError, sendRef } = useTerminalEmulator();
  sendRef.current = send;
  const feed = term.feed;
  const feedSeen = useRef(0);
  const session = term.session;
  // The pick epoch this view last acted on: a bump means "the reader chose a
  // different shell — the next open carries it" (a running pty was killed by
  // the gesture itself, on the start page).
  const pickSeen = useRef(pick);

  // The shell inventory is asked for by THIS page: opening the tab is enough to
  // populate the guide's menu (the answer rides one frame; there is no other
  // reader).
  const shellsMissing = shells === null;
  useEffect(() => {
    if (!connected || !shellsMissing) return;
    sendRef.current({ type: 'discover_shells' });
  }, [connected, shellsMissing, sendRef]);

  // Open/reattach once the emulator exists AND the shell inventory is known:
  // the host answers with the whole retained scrollback (reset), so the screen
  // rebuilds from the pty's own bytes. The initial grid rides the open so the
  // pty is born at the right size; the resolved shell rides it because the
  // FIRST open decides the process (term_open on a live pty only replays). An
  // open sent before the `shells` answer would be spawned as the host default
  // and the reader's remembered choice would never get its turn — so it waits
  // (the missing-inventory ask above is what completes the pair).
  useEffect(() => {
    const instance = api.current;
    if (!ready || !connected || instance === null) return;
    const frame = terminalOpenFrame(instance.grid(), shells, readShellPreference());
    if (frame === null) return;
    pickSeen.current = pick;
    sendRef.current(frame);
    // Switching into the terminal tab is a "I want to type here" gesture.
    instance.focus();
  }, [ready, connected, api, session, rootDir, shells, pick, sendRef]);

  // Consume owed output batches in order, and only once: the effect re-runs on
  // any dependency change (the emulator's own mount, say), and replaying bytes
  // xterm already ate would duplicate the screen. The ref is advanced FIRST — a
  // write that throws must not make the next paint eat them again.
  useEffect(() => {
    const instance = api.current;
    if (instance === null || feed === null || feed.seq === feedSeen.current) return;
    feedSeen.current = feed.seq;
    if (feed.overflow === true) {
      // The slot holds a hole, not a stream (the emulator was away while the
      // pty talked): writing it would paint a truncated escape as junk. The
      // host's ring is the reconstruction — ask for it and write what follows.
      const { cols, rows } = instance.grid();
      sendRef.current({ type: 'term_open', cols, rows });
      return;
    }
    if (feed.reset) instance.reset();
    if (feed.data.length > 0) instance.write(feed.data);
  }, [api, feed, ready, sendRef]);

  const respawn = (): void => {
    // Kill-then-open: ONE respawn rule lives on the host (an exited pty is
    // never silently replaced), so the gesture is explicit about both halves.
    const instance = api.current;
    send({ type: 'term_kill' });
    const grid = instance?.grid() ?? { cols: 80, rows: 24 };
    send(terminalOpenFrame(grid, shells, readShellPreference()) ?? { type: 'term_open', cols: grid.cols, rows: grid.rows });
    instance?.focus();
  };

  const ended = term.status === 'exited' || term.status === 'off';
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
      {term.status !== 'running' && (
        <footer className={css.footer}>
          <span className={css.status} role="status" data-status={term.status}>{termStatusWord(term)}</span>
          {term.status === 'unavailable' && (
            <button
              type="button"
              className={css.retry}
              title={RIGHTBAR_COPY['term.restart']}
              disabled={!connected || rootDir === ''}
              onClick={respawn}
            >
              <RefreshGlyph />
              {RIGHTBAR_COPY['term.restart']}
            </button>
          )}
          {ended && (
            <button
              type="button"
              className={css.newButton}
              disabled={!connected || rootDir === ''}
              onClick={respawn}
            >
              {RIGHTBAR_COPY['term.new']}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
