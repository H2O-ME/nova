/**
 * The 终端 tab's model (`rightbar/terminal-model.ts`).
 *
 * One rule decides whether the tab is usable: **text appends, state replaces.**
 * A poll answers with the chunk that arrived since the last one plus the job's
 * current status, so a fold that replaces the text loses output and a fold that
 * accumulates the status prints nonsense. Both halves are asserted here.
 */
import { describe, expect, it } from 'vitest';
import {
  emptyTerminal,
  runningIds,
  terminalForSession,
  upsertTerminal,
  type TerminalFrameState,
} from '../src/rightbar/terminal-model.js';

const frame = (over: Partial<TerminalFrameState> & { id: string }): TerminalFrameState => ({
  command: 'pnpm test',
  status: 'running',
  text: '',
  ...over,
});

describe('terminal model', () => {
  it('appends each poll’s chunk to the job’s screen', () => {
    const first = upsertTerminal(emptyTerminal, frame({ id: 'bash-1', text: 'step 1\n' }));
    const second = upsertTerminal(first, frame({ id: 'bash-1', text: 'step 2\n' }));
    expect(second.jobs[0]?.text).toBe('step 1\nstep 2\n');
    expect(second.jobs).toHaveLength(1);
  });

  it('replaces the status and the detail rather than accumulating them', () => {
    const running = upsertTerminal(emptyTerminal, frame({ id: 'bash-1', text: 'a' }));
    const done = upsertTerminal(running, frame({ id: 'bash-1', status: 'completed', detail: 'exit code: 0', text: 'b' }));
    expect(done.jobs[0]).toMatchObject({ status: 'completed', detail: 'exit code: 0', text: 'ab' });
  });

  it('keeps the command line a job already had when an answer omits it', () => {
    // A refusal for a known id carries no command; blanking the line the reader
    // is looking at would hide which command failed.
    const started = upsertTerminal(emptyTerminal, frame({ id: 'bash-1', command: 'npm run build' }));
    const refused = upsertTerminal(started, frame({ id: 'bash-1', command: '', status: 'failed', error: '任务已不存在' }));
    expect(refused.jobs[0]?.command).toBe('npm run build');
    expect(refused.error).toBe('任务已不存在');
  });

  it('appends a job it has not seen before, in submission order', () => {
    const one = upsertTerminal(emptyTerminal, frame({ id: 'bash-1', command: 'one' }));
    const two = upsertTerminal(one, frame({ id: 'bash-2', command: 'two' }));
    expect(two.jobs.map((job) => job.id)).toEqual(['bash-1', 'bash-2']);
  });

  it('shows the host’s refusal as the panel’s own line', () => {
    const refused = upsertTerminal(emptyTerminal, frame({ id: '', command: 'x', status: 'failed', error: 'cannot spawn shell' }));
    expect(refused).toMatchObject({ jobs: [], error: 'cannot spawn shell' });
  });

  it('polls only what is still writing', () => {
    let state = upsertTerminal(emptyTerminal, frame({ id: 'bash-1' }));
    state = upsertTerminal(state, frame({ id: 'bash-2', status: 'completed' }));
    state = upsertTerminal(state, frame({ id: 'bash-3', status: 'stopping' }));
    // `stopping` is included: the kill was requested, but the dying process can
    // still write its last bytes into the ring.
    expect(runningIds(state)).toEqual(['bash-1', 'bash-3']);
  });

  it('drops the previous session’s jobs at a switch, and only then', () => {
    const started = upsertTerminal(emptyTerminal, frame({ id: 'bash-1', text: 'old output' }));
    const stamped = terminalForSession(started, '/n/s1.jsonl');
    expect(terminalForSession(stamped, '/n/s1.jsonl')).toBe(stamped);
    const switched = terminalForSession(stamped, '/n/s2.jsonl');
    expect(switched.jobs).toEqual([]);
    expect(switched.session).toBe('/n/s2.jsonl');
  });
});
