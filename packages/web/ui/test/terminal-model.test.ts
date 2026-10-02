/**
 * The 终端 page's model (`rightbar/terminal-model.ts`).
 *
 * The reducer no longer renders the terminal — the emulator does — so the
 * model's contracts are the ones a rewrite can silently drop:
 *
 *  - **Bytes flow to the emulator untouched**, accumulated under a rising
 *    `seq` (frames arrive in bursts and are consumed at render rate, so the
 *    slot must never keep only the last one);
 *  - **`reset` means clear-then-write** (a replay, or a kill), and a later
 *    reset discards the bytes it is about to clear;
 *  - **status/exit-code/error are the fold's own readings**, and an error
 *    leaves as soon as real bytes arrive;
 *  - **a session switch forgets the terminal** (the pty belongs to a session
 *    the reader may no longer see);
 *  - **overflow is stated, not hidden**: past `TERM_FEED_LIMIT` the batch is
 *    dropped and flagged so the view re-reads the host's ring.
 */
import { describe, expect, it } from 'vitest';
import {
  applyTerm,
  emptyTerm,
  TERM_FEED_LIMIT,
  termForSession,
  termStatusWord,
  type TermFrame,
  type TermState,
} from '../src/rightbar/terminal-model.js';
import { RIGHTBAR_COPY } from '../src/rightbar/copy.js';

function frame(over: Partial<TermFrame> = {}): TermFrame {
  return { data: '', status: 'running', ...over };
}

const opened: TermState = { ...emptyTerm, session: '/n/one.jsonl' };

describe('terminal model', () => {
  it('accumulates frames folded before a render — no byte may be dropped', () => {
    // The killing case: a burst (open reply + banner + prompt) folds into ONE
    // render; a single-slot feed kept only the last frame, and the truncated
    // ANSI stream painted junk where the screen should have text.
    const reset = applyTerm(opened, frame({ reset: true, data: '' }));
    const modes = applyTerm(reset, frame({ data: '\u001b[?9001h\u001b[?1004h' }));
    const banner = applyTerm(modes, frame({ data: 'Microsoft Windows\r\n' }));
    expect(banner.feed).toEqual({
      data: '\u001b[?9001h\u001b[?1004hMicrosoft Windows\r\n',
      reset: true,
      seq: 3,
    });
  });

  it('a later reset frame discards the bytes it is about to clear', () => {
    // Clear-then-write of the replay is exactly what sequential processing
    // would have produced: the earlier bytes were going to be erased anyway.
    const stale = applyTerm(opened, frame({ data: 'stale output\r\n' }));
    const replay = applyTerm(stale, frame({ reset: true, data: '$ ls\r\n' }));
    expect(replay.feed).toEqual({ data: '$ ls\r\n', reset: true, seq: 2 });
  });

  it('drops the batch and says so when the emulator was away too long', () => {
    const big = applyTerm(opened, frame({ data: 'x'.repeat(TERM_FEED_LIMIT + 1) }));
    expect(big.feed?.overflow).toBe(true);
    expect(big.feed?.data).toBe('');
    // One short frame right after is owed as usual — the view re-reads the
    // ring on its own (the flag rode the batch that overflowed).
    const next = applyTerm(big, frame({ data: 'ok\r\n' }));
    expect(next.feed).toEqual({ data: 'ok\r\n', reset: false, seq: 2 });
  });

  it('does not mint a feed batch for a state-only frame', () => {
    const withBytes = applyTerm(opened, frame({ data: 'hi\r\n' }));
    const stateOnly = applyTerm(withBytes, frame({ status: 'exited', exitCode: 0 }));
    expect(stateOnly.feed).toBe(withBytes.feed);
    expect(stateOnly.status).toBe('exited');
    expect(stateOnly.exitCode).toBe(0);
  });

  it('marks a replay batch so the emulator clears before writing', () => {
    const replay = applyTerm(opened, frame({ data: '…tail', reset: true }));
    expect(replay.feed).toMatchObject({ data: '…tail', reset: true });
    const cleared = applyTerm(opened, frame({ reset: true, data: '' }));
    expect(cleared.feed).toMatchObject({ data: '', reset: true });
  });

  it('carries the spawn refusal and clears it when bytes arrive', () => {
    const refused = applyTerm(opened, frame({ status: 'unavailable', error: 'Cannot find module' }));
    expect(refused.error).toBe('Cannot find module');
    // A state-only frame leaves the standing error; bytes end it.
    expect(applyTerm(refused, frame({ status: 'running' })).error).toBe('Cannot find module');
    expect(applyTerm(refused, frame({ data: 'x' })).error).toBeUndefined();
  });

  it('forgets the terminal when the reader switches sessions', () => {
    const live = applyTerm(opened, frame({ data: 'work\r\n' }));
    expect(termForSession(live, '/n/one.jsonl')).toBe(live);
    const other = termForSession(live, '/n/two.jsonl');
    expect(other.status).toBe('off');
    expect(other.feed).toBeNull();
    expect(other.session).toBe('/n/two.jsonl');
  });

  it('names each life in the status word', () => {
    expect(termStatusWord(opened)).toBe(RIGHTBAR_COPY['term.off']);
    expect(termStatusWord({ ...opened, status: 'running' })).toBe(RIGHTBAR_COPY['term.running']);
    expect(termStatusWord({ ...opened, status: 'exited' })).toBe(RIGHTBAR_COPY['term.exited']);
    expect(termStatusWord({ ...opened, status: 'exited', exitCode: 3 }))
      .toBe(RIGHTBAR_COPY['term.code'].replace('{code}', '3'));
    expect(termStatusWord({ ...opened, status: 'unavailable' })).toBe(RIGHTBAR_COPY['term.unavailable']);
  });
});
