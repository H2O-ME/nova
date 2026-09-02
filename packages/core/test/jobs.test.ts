import { describe, expect, it } from 'vitest';
import { JobRegistry, type JobOutcome } from '../src/index.js';

function deferred(): { promise: Promise<JobOutcome>; resolve: (o: JobOutcome) => void } {
  let resolve!: (o: JobOutcome) => void;
  const promise = new Promise<JobOutcome>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('JobRegistry', () => {
  it('assigns kind-prefixed ids and tracks lifecycle to completion', async () => {
    const registry = new JobRegistry();
    const d = deferred();
    const snapshot = registry.start({
      kind: 'bash',
      label: 'sleep 10',
      cancel: () => {},
      done: d.promise,
    });
    expect(snapshot.id).toBe('bash-1');
    expect(snapshot.status).toBe('running');

    d.resolve({ status: 'completed', detail: 'exit code: 0' });
    await d.promise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.get('bash-1')?.status).toBe('completed');
    expect(registry.get('bash-1')?.detail).toBe('exit code: 0');
  });

  it('stop() marks stopping, is idempotent, and settles as killed', async () => {
    const registry = new JobRegistry();
    let cancelCalls = 0;
    const d = deferred();
    registry.start({
      kind: 'bash',
      label: 'long task',
      cancel: () => {
        cancelCalls += 1;
        d.resolve({ status: 'killed', detail: 'exit code: null' });
      },
      done: d.promise,
    });

    await registry.stop('bash-1');
    await registry.stop('bash-1');
    expect(cancelCalls).toBe(1);
    await d.promise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(registry.get('bash-1')?.status).toBe('killed');
  });

  it('readOutput returns only output produced since the previous call', () => {
    const registry = new JobRegistry();
    let buffer = '';
    registry.start({
      kind: 'bash',
      label: 'producer',
      cancel: () => {},
      done: Promise.resolve({ status: 'completed' }),
      readOutput: () => {
        const chunk = buffer;
        buffer = '';
        return chunk;
      },
    });
    // simulate producer writes through the shared closure
    buffer = 'hello ';
    expect(registry.readOutput('bash-1')).toBe('hello ');
    expect(registry.readOutput('bash-1')).toBe('');
    buffer = 'world';
    expect(registry.readOutput('bash-1')).toBe('world');
  });

  it('keeps the subagent kind reserved and fails unknown job lookups gracefully', () => {
    const registry = new JobRegistry();
    const snapshot = registry.start({
      kind: 'subagent',
      label: 'explore',
      cancel: () => {},
      done: Promise.resolve({ status: 'completed' }),
    });
    expect(snapshot.kind).toBe('subagent');
    expect(registry.get(snapshot.id)?.kind).toBe('subagent');
    expect(registry.get('bash-99')).toBeUndefined();
    expect(registry.readOutput('bash-99')).toBeUndefined();
  });
});
