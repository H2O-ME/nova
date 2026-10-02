/**
 * The 终端 page's model (`rightbar/terminal-model.ts`).
 *
 * The reducer no longer renders the terminal — the emulator does — so the
 * model's contracts are the ones a rewrite can silently drop:
 *
 *  - **Bytes flow to the emulator untouched**, batched under a rising `seq`;
 *  - **`reset` means clear-then-write** (a replay, or a kill);
 *  - **status/exit-code/error are the fold's own readings**, and an error
 *    leaves as soon as real bytes arrive;
 *  - **a session switch forgets the terminal** (the pty belongs to a session
 *    the reader may no longer see).
 */
import { describe, expect, it } from 'vitest';
import {
  applyTerm,
  emptyTerm,
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
  it('hands pty bytes to the feed untouched, numbered by seq', () => {
    const first = applyTerm(opened, frame({ data: '$ ls\r\n' }));
    expect(first.feed).toEqual({ data: '$ ls\r\n', reset: false, seq: 1 });
    const second = applyTerm(first, frame({ data: 'a.ts\r\n' }));
    expect(second.feed?.seq).toBe(2);
    expect(second.feed?.data).toBe('a.ts\r\n');
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
