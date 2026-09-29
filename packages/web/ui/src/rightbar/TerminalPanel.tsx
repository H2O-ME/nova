/**
 * The 终端 tab's body: run one command in the session's workspace and watch it
 * print.
 *
 * **What this is, precisely.** The command is submitted once and becomes an
 * ordinary background job of the live session; the panel drains its output while
 * it runs and stops it through the same `stop_job` frame the transcript's job
 * rows use. There is no PTY: no stdin, no window size, no signal beyond stop.
 * That is why the empty state says so — a reader who expects an interactive
 * shell would type into a box that cannot answer them.
 *
 * The polling belongs to the panel rather than the socket because output is the
 * one fact a reader watches continuously: each poll is a cursor move on the
 * job's output ring (`read_terminal`), and the timer exists only while something
 * is running. The harness reaches the same place from the other side (its
 * terminal owns a persistent process and pushes screen updates); this surface
 * has no process to own, so it asks.
 */
import { useEffect, useRef, useState } from 'react';
import { StopIcon } from '../icons.js';
import type { ClientFrame } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';
import { runningIds, TERMINAL_STATUS_WORDS, type TerminalState } from './terminal-model.js';
import css from './RightbarPanel.module.css';

/**
 * How often a running command's output is drained. Fast enough that a build's
 * progress lines arrive while they still read as progress, slow enough that a
 * quiet command costs four round trips a second rather than sixty.
 */
export const TERMINAL_POLL_MS = 400;

export interface TerminalPanelProps {
  state: TerminalState;
  /** The workspace root, shown as the command's working directory. */
  rootDir: string;
  /**
   * The log the kernel is attached to. The panel re-lists on a CHANGE of it:
   * the host's terminal jobs belong to a session, so a switch means the rows on
   * screen (if any survived) are about commands this session does not own.
   */
  sessionFile: string;
  /** A socket is open: without one a submit would vanish into nothing. */
  connected: boolean;
  send: (frame: ClientFrame) => void;
}

export function TerminalPanel({ state, rootDir, sessionFile, connected, send }: TerminalPanelProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const running = runningIds(state);
  // The poll's identity is the SET of running ids, not the state object: a new
  // output chunk would otherwise restart the timer on every frame and a chatty
  // command would never actually be polled.
  const runningKey = running.join(',');
  const outRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (runningKey.length === 0) return;
    const ids = runningKey.split(',');
    const timer = window.setInterval(() => {
      for (const id of ids) send({ type: 'read_terminal', id });
    }, TERMINAL_POLL_MS);
    return () => { window.clearInterval(timer); };
  }, [runningKey, send]);

  // A reloaded page rebuilds its list from the host: the jobs outlive the socket,
  // so the panel must not start empty while a command is still writing. The same
  // ask runs on a session switch, which is the other moment the list is stale.
  useEffect(() => { send({ type: 'list_terminal' }); }, [send, sessionFile]);

  // Follow the tail: output arrives at the bottom, and a reader watching a build
  // should not have to scroll to it.
  useEffect(() => {
    const el = outRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [state.jobs]);

  const submit = (): void => {
    const command = draft.trim();
    if (command.length === 0 || !connected) return;
    send({ type: 'run_terminal', command });
    setDraft('');
  };

  return (
    <div className={css.terminal}>
      <form
        className={css.commandBar}
        onSubmit={(event) => { event.preventDefault(); submit(); }}
      >
        <input
          className={css.commandInput}
          type="text"
          value={draft}
          placeholder={RIGHTBAR_COPY['terminal.input.placeholder']}
          aria-label={RIGHTBAR_COPY['terminal.input.label']}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => { setDraft(event.target.value); }}
        />
        <button
          type="submit"
          className={css.runButton}
          disabled={!connected || draft.trim().length === 0}
        >
          {RIGHTBAR_COPY['terminal.run']}
        </button>
      </form>
      <p className={css.pathLine} title={rootDir}>{rootDir}</p>
      {state.error !== null && <p className={css.errorLine}>{state.error}</p>}
      <div className={css.terminalBody} ref={outRef}>
        {state.jobs.length === 0 ? (
          <div className={css.empty}>
            <p className={css.emptyTitle}>{RIGHTBAR_COPY['terminal.empty']}</p>
            <p className={css.emptyNote}>{RIGHTBAR_COPY['terminal.empty.note']}</p>
          </div>
        ) : (
          state.jobs.map((job) => (
            <section key={job.id} className={css.job} data-status={job.status}>
              <header className={css.jobHead}>
                <span className={css.jobCommand} title={job.command}>{job.command}</span>
                <span className={css.jobStatus}>
                  {TERMINAL_STATUS_WORDS[job.status]}
                  {job.detail !== undefined ? ` · ${job.detail}` : ''}
                </span>
                {(job.status === 'running' || job.status === 'stopping') && (
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={RIGHTBAR_COPY['terminal.stop']}
                    title={RIGHTBAR_COPY['terminal.stop']}
                    disabled={!connected}
                    onClick={() => { send({ type: 'stop_job', id: job.id }); }}
                  >
                    <StopIcon />
                  </button>
                )}
              </header>
              <pre className={css.jobOutput}>{job.text.length > 0 ? job.text : ' '}</pre>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
