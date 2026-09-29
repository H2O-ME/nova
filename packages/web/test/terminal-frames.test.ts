/**
 * The right panel's terminal frames (`terminal-frames.ts`).
 *
 * Two contracts are asserted here, and both were design decisions rather than
 * mechanics:
 *
 *  1. **A poll drains.** `read_terminal` moves the job's output cursor, so two
 *     polls return two halves, not the same text twice. A panel that re-received
 *     everything would re-render a build's whole log every 400ms.
 *  2. **Only the panel's own jobs are readable.** The job registry cannot tell a
 *     command the panel ran from one the model ran — both are `kind: 'bash'` —
 *     so the ledger is what keeps this reader from consuming output the model was
 *     told to read (`jobs output`). A second reader on one cursor is a silent
 *     data-loss bug, and this is the assertion that refuses it.
 *
 * Driven through the frame handler with a real `JobRegistry` and a scripted
 * starter, so the test is about the answers the panel receives.
 */
import { JobRegistry, type JobSnapshot } from '@nova-agent/core';
import { describe, expect, it } from 'vitest';
import { parseClientFrame } from '../src/client-frame.js';
import { MAX_TERMINAL_COMMAND_CHARS, type ServerFrame } from '../src/protocol.js';
import { handleTerminalFrame, TerminalLedger, type TerminalFrame, type TerminalHost } from '../src/terminal-frames.js';
import type { WsConnection } from '../src/ws.js';

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
  close(): void {}
  terminals(): Extract<ServerFrame, { type: 'terminal' }>[] {
    return this.frames.filter((frame): frame is Extract<ServerFrame, { type: 'terminal' }> => frame.type === 'terminal');
  }
  last(): Extract<ServerFrame, { type: 'terminal' }> | undefined {
    return this.terminals().at(-1);
  }
}

interface Rig {
  host: TerminalHost;
  conn: FakeConn;
  /** Append output to a job's ring, as a real producer would. */
  emit: (id: string, text: string) => void;
  /** Settle a job (its producer finished) and let the registry observe it. */
  settle: (id: string, status: 'completed' | 'failed') => Promise<void>;
  /** Run one terminal frame. */
  run: (frame: TerminalFrame) => void;
  /** Start a job OUTSIDE the panel (what the model's bash tool does). */
  startForeign: (label: string) => string;
}

function makeRig(): Rig {
  const jobs = new JobRegistry();
  const conn = new FakeConn();
  const ledger = new TerminalLedger();
  /** Job id → chunks not yet drained. */
  const buffers = new Map<string, string[]>();
  /** Job id → its producer's settle function. */
  const resolvers = new Map<string, (outcome: { status: 'completed' | 'failed'; detail?: string }) => void>();

  const spawn = (label: string, sessionId: string): JobSnapshot => {
    let resolveDone: (outcome: { status: 'completed' | 'failed'; detail?: string }) => void = () => {};
    const done = new Promise<{ status: 'completed' | 'failed'; detail?: string }>((resolve) => { resolveDone = resolve; });
    const snapshot: JobSnapshot = jobs.start({
      kind: 'bash',
      label,
      sessionId,
      cancel: () => {},
      done,
      // The closure reads the buffer by id, so it works from the first poll on.
      readOutput: () => (buffers.get(snapshot.id) ?? []).splice(0).join(''),
    });
    buffers.set(snapshot.id, []);
    resolvers.set(snapshot.id, resolveDone);
    return snapshot;
  };

  const terminalHost: TerminalHost = {
    jobs,
    sessionId: 's1',
    ledger,
    start: (command) => spawn(command, 's1'),
  };

  return {
    host: terminalHost,
    conn,
    emit: (id, text) => { buffers.set(id, [...(buffers.get(id) ?? []), text]); },
    settle: async (id, status) => {
      resolvers.get(id)?.({ status, detail: status === 'completed' ? 'exit code: 0' : 'exit code: 1' });
      // The registry learns the outcome in a microtask (`done.then`).
      await Promise.resolve();
      await Promise.resolve();
    },
    run: (frame) => { handleTerminalFrame(conn, frame, terminalHost); },
    startForeign: (label) => spawn(label, 's1').id,
  };
}

describe('terminal frames', () => {
  it('starts a command as this session’s job and answers with its id', () => {
    const rig = makeRig();
    rig.run({ type: 'run_terminal', command: 'pnpm test' });
    expect(rig.conn.last()).toMatchObject({ id: 'bash-1', command: 'pnpm test', status: 'running', text: '' });
    // The job is stamped with the LIVE session, which is what scopes it to this
    // conversation and lets the registry dispose it when the session ends.
    expect(rig.host.jobs.list('s1').map((job) => job.id)).toEqual(['bash-1']);
  });

  it('drains on each poll instead of resending the whole log', () => {
    const rig = makeRig();
    rig.run({ type: 'run_terminal', command: 'build' });
    rig.emit('bash-1', 'step 1\n');
    rig.run({ type: 'read_terminal', id: 'bash-1' });
    expect(rig.conn.last()).toMatchObject({ id: 'bash-1', text: 'step 1\n' });
    rig.emit('bash-1', 'step 2\n');
    rig.run({ type: 'read_terminal', id: 'bash-1' });
    // The second answer carries ONLY what arrived since the first.
    expect(rig.conn.last()?.text).toBe('step 2\n');
  });

  it('carries the settled status and detail on the poll that observes it', async () => {
    const rig = makeRig();
    rig.run({ type: 'run_terminal', command: 'build' });
    rig.emit('bash-1', 'done\n');
    await rig.settle('bash-1', 'completed');
    rig.run({ type: 'read_terminal', id: 'bash-1' });
    expect(rig.conn.last()).toMatchObject({ status: 'completed', text: 'done\n', detail: 'exit code: 0' });
  });

  it('refuses to read a job the panel did not start', () => {
    // The registry answers for any job of this session; the ledger is the only
    // reason the panel cannot drain the model's `jobs output` cursor with it.
    const rig = makeRig();
    const foreign = rig.startForeign('model command');
    rig.emit(foreign, 'model output');
    rig.run({ type: 'read_terminal', id: foreign });
    expect(rig.conn.last()).toMatchObject({ id: foreign, status: 'failed', text: '' });
    expect(rig.conn.last()?.error).toContain('未知的终端任务');
    // And the output is still there for its real reader.
    expect(rig.host.jobs.readOutput(foreign, 1024, 's1')).toBe('model output');
  });

  it('turns a refused spawn into the panel’s own line, not a transcript error', () => {
    const rig = makeRig();
    handleTerminalFrame(
      rig.conn,
      { type: 'run_terminal', command: 'x' },
      { ...rig.host, start: () => 'Error: cannot spawn shell (bash.exe): ENOENT' },
    );
    expect(rig.conn.last()).toMatchObject({ id: '', status: 'failed', text: '' });
    expect(rig.conn.last()?.error).toContain('cannot spawn shell');
    // One frame, and it is the panel's: nothing was written into the transcript.
    expect(rig.conn.terminals()).toHaveLength(1);
  });

  it('re-lists the panel’s live jobs after a reload, and forgets the settled ones', async () => {
    const rig = makeRig();
    rig.run({ type: 'run_terminal', command: 'one' });
    rig.run({ type: 'run_terminal', command: 'two' });
    await rig.settle('bash-2', 'completed');
    // Observing the settled job is what drops it from the ledger: a rebuilt panel
    // must not re-open a command whose output has stopped growing.
    rig.run({ type: 'read_terminal', id: 'bash-2' });
    rig.conn.frames.length = 0;
    rig.run({ type: 'list_terminal' });
    expect(rig.conn.terminals().map((frame) => frame.id)).toEqual(['bash-1']);
  });

  it('forgets a job the registry no longer knows', () => {
    const rig = makeRig();
    rig.host.ledger.add('s1', 'bash-9');
    rig.run({ type: 'read_terminal', id: 'bash-9' });
    expect(rig.conn.last()?.error).toContain('终端任务已不存在');
    expect(rig.host.ledger.ids('s1')).toEqual([]);
  });
});

describe('terminal frames on the wire', () => {
  const parse = (value: unknown): unknown => parseClientFrame(JSON.stringify(value));

  it('accepts a command, a poll and a re-list', () => {
    expect(parse({ type: 'run_terminal', command: 'pnpm test && echo done' })).toEqual({
      type: 'run_terminal',
      command: 'pnpm test && echo done',
    });
    // A heredoc is one command: newlines are the field's content, not junk.
    expect(parse({ type: 'run_terminal', command: 'cat <<EOF\nhi\nEOF' })).toMatchObject({ type: 'run_terminal' });
    expect(parse({ type: 'read_terminal', id: 'bash-1' })).toEqual({ type: 'read_terminal', id: 'bash-1' });
    expect(parse({ type: 'list_terminal' })).toEqual({ type: 'list_terminal' });
  });

  it('refuses an empty, oversized or control-bearing command', () => {
    expect(parse({ type: 'run_terminal', command: '   ' })).toMatchObject({ ok: false });
    expect(parse({ type: 'run_terminal' })).toMatchObject({ ok: false });
    expect(parse({ type: 'run_terminal', command: 'x'.repeat(MAX_TERMINAL_COMMAND_CHARS + 1) })).toMatchObject({ ok: false });
    expect(parse({ type: 'run_terminal', command: 'echo \u0007' })).toMatchObject({ ok: false });
  });

  it('takes a job id as a token, never as free text', () => {
    // The id reaches the registry: anything that is not the registry's own
    // alphabet is a malformed frame, not a lookup to attempt.
    expect(parse({ type: 'read_terminal', id: 'bash-1; rm -rf /' })).toMatchObject({ ok: false });
    expect(parse({ type: 'read_terminal' })).toMatchObject({ ok: false });
  });
});
