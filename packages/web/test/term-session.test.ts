/**
 * The 终端 tab's pty session, driven by a FAKE pty handle.
 *
 * The session's own rules — the ring bound, the split-surrogate hold, the
 * lifecycle callbacks — are pure enough to test without a real shell: the
 * production spawner is injectable, and the real PTY's end-to-end behaviour is
 * the live smoke run's subject (`pnpm smoke:web`), not the unit lane's.
 */
import { describe, expect, it } from 'vitest';
import {
  holdSplitSurrogate,
  killPtyTree,
  TermRegistry,
  type PtyHandle,
  type PtySpawner,
} from '../src/term-session.js';

/** A scripted pty: records writes, replays emit/exit to the test. */
class FakePty implements PtyHandle {
  readonly written: string[] = [];
  readonly resized: Array<{ cols: number; rows: number }> = [];
  killed = false;
  private readonly dataCbs: Array<(chunk: string) => void> = [];
  private readonly exitCbs: Array<(code: number | undefined) => void> = [];

  get pid(): number {
    return 4242;
  }

  write(data: string): void {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }

  kill(): void {
    this.killed = true;
  }

  onData(cb: (chunk: string) => void): void {
    this.dataCbs.push(cb);
  }

  onExit(cb: (exitCode: number | undefined) => void): void {
    this.exitCbs.push(cb);
  }

  emit(data: string): void {
    for (const cb of this.dataCbs) cb(data);
  }

  exit(code: number | undefined): void {
    for (const cb of this.exitCbs) cb(code);
  }
}

/** A registry whose spawner hands back the test's own fake. */
function fakeRegistry(): {
  registry: TermRegistry;
  pty: FakePty;
  launch: () => Array<{ file: string; args: readonly string[]; cwd: string; cols: number; rows: number }>;
} {
  const pty = new FakePty();
  const launches: Array<{ file: string; args: readonly string[]; cwd: string; cols: number; rows: number }> = [];
  const spawn: PtySpawner = async (opts) => {
    launches.push(opts);
    return pty;
  };
  return { registry: new TermRegistry(spawn), pty, launch: () => launches };
}

function launchOpts(): { file: string; args: readonly string[]; cwd: string; cols: number; rows: number } {
  return { file: 'bash.exe', args: ['-i'], cwd: '/w', cols: 120, rows: 30 };
}

describe('holdSplitSurrogate', () => {
  it('parks a dangling high surrogate until the next chunk completes it', () => {
    const split = holdSplitSurrogate('a\uD83D', false);
    expect(split.text).toBe('a');
    expect(split.rest).toBe('\uD83D');
  });

  it('releases a complete chunk as-is', () => {
    expect(holdSplitSurrogate('ok', false)).toEqual({ text: 'ok', rest: '' });
  });

  it('flushes a dangling half when the producer is done', () => {
    expect(holdSplitSurrogate('a\uD83D', true)).toEqual({ text: 'a\uD83D', rest: '' });
  });
});

describe('TermSession', () => {
  it('forwards output verbatim, minus a split surrogate held at the boundary', async () => {
    const { registry, pty } = fakeRegistry();
    const chunks: string[] = [];
    await registry.ensure('s1', launchOpts(), (chunk) => { chunks.push(chunk); }, () => {});
    pty.emit('plain\r\n');
    pty.emit('pic\u{1F600}\r\n');
    expect(chunks).toEqual(['plain\r\n', 'pic\u{1F600}\r\n']);
  });

  it('keeps the scrollback ring bounded from the head', async () => {
    const { registry, pty } = fakeRegistry();
    await registry.ensure('s1', launchOpts(), () => {}, () => {});
    pty.emit('x'.repeat(300));
    const session = registry.get('s1')!;
    expect(session.scrollback().length).toBe(300);
    // Exceed the bound: the oldest end is gone, the tail is intact.
    pty.emit('y'.repeat(300 * 1024));
    expect(session.scrollback().length).toBeLessThanOrEqual(256 * 1024 + 300);
    expect(session.scrollback().endsWith('y'.repeat(64))).toBe(true);
  });

  it('adopts the exit code once and stops forwarding writes', async () => {
    const { registry, pty } = fakeRegistry();
    const exits: Array<number | undefined> = [];
    await registry.ensure('s1', launchOpts(), () => {}, (code) => { exits.push(code); });
    const session = registry.get('s1')!;
    pty.exit(7);
    expect(exits).toEqual([7]);
    expect(session.status).toBe('exited');
    session.write('late\r');
    expect(pty.written).toEqual([]);
  });

  it('kills the tree and marks itself exited', async () => {
    const { registry, pty } = fakeRegistry();
    await registry.ensure('s1', launchOpts(), () => {}, () => {});
    const session = registry.get('s1')!;
    session.kill();
    expect(pty.killed).toBe(true);
    expect(session.status).toBe('exited');
    // Idempotent: a second kill does not re-sweep.
    pty.killed = false;
    session.kill();
    expect(pty.killed).toBe(false);
  });
});

describe('TermRegistry', () => {
  it('spawns once per session and reuses the same terminal', async () => {
    const { registry, launch } = fakeRegistry();
    const first = await registry.ensure('s1', launchOpts(), () => {}, () => {});
    const second = await registry.ensure('s1', launchOpts(), () => {}, () => {});
    expect(second).toBe(first);
    expect(launch()).toHaveLength(1);
    // The pty is born at the asking emulator's grid, in the asking workspace.
    expect(launch()[0]).toMatchObject({ file: 'bash.exe', cwd: '/w', cols: 120, rows: 30 });
  });

  it('does not silently replace an exited terminal — its scrollback is the reading', async () => {
    const { registry, launch } = fakeRegistry();
    const first = await registry.ensure('s1', launchOpts(), () => {}, () => {});
    first.kill();
    const again = await registry.ensure('s1', launchOpts(), () => {}, () => {});
    expect(again).toBe(first);
    expect(launch()).toHaveLength(1);
  });

  it('retainOnly takes every other session down', async () => {
    const a = new FakePty();
    const b = new FakePty();
    const spawn: PtySpawner = async (opts) => (opts.cwd === '/w-a' ? a : b);
    const reg = new TermRegistry(spawn);
    await reg.ensure('a', { ...launchOpts(), cwd: '/w-a' }, () => {}, () => {});
    await reg.ensure('b', launchOpts(), () => {}, () => {});
    reg.retainOnly('b');
    expect(reg.get('a')).toBeUndefined();
    expect(reg.get('b')).toBeDefined();
    expect(a.killed).toBe(true);
    expect(b.killed).toBe(false);
  });
});

describe('killPtyTree', () => {
  it('delegates to the handle and survives a dead process', () => {
    const pty = new FakePty();
    killPtyTree(pty);
    expect(pty.killed).toBe(true);
    // A pid the OS cannot act on must not throw out of the sweep.
    const dead = new FakePty();
    Object.defineProperty(dead, 'pid', { value: 0 });
    expect(() => killPtyTree(dead)).not.toThrow();
  });
});
