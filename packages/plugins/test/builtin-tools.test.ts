import { describe, expect, it } from 'vitest';
import { JobRegistry, type TodoItem } from '@nova-agent/core';
import { PluginHost, builtinPlugins } from '../src/index.js';
import { bashOnPath } from '../src/builtin/bash.js';

async function activatedHost(): Promise<{ host: PluginHost; jobs: JobRegistry; emitted: unknown[] }> {
  const host = new PluginHost('.');
  const jobs = new JobRegistry();
  const emitted: unknown[] = [];
  for (const plugin of builtinPlugins()) host.use(plugin);
  await host.activate();
  return { host, jobs, emitted };
}

describe('todo plugin', () => {
  it('replaces the whole list and emits a log-only todo/write event', async () => {
    const { host, emitted } = await activatedHost();
    const todo = host.tools.find((t) => t.name === 'todo_write')!;
    const todos: TodoItem[] = [
      { content: 'investigate failure', status: 'completed' },
      { content: 'apply fix', status: 'in_progress' },
      { content: 're-run tests', status: 'pending' },
    ];
    const result = await todo.execute({ todos }, { rootDir: '.', emit: (evt) => void emitted.push(evt) });

    expect(result).toContain('[x] investigate failure');
    expect(result).toContain('[~] apply fix');
    expect(result).toContain('[ ] re-run tests');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: 'todo/write', todos });
  });

  it('rejects malformed entries', async () => {
    const { host } = await activatedHost();
    const todo = host.tools.find((t) => t.name === 'todo_write')!;
    expect(await todo.execute({ todos: [{ content: 'x', status: 'done' }] }, { rootDir: '.' })).toContain('Error:');
    expect(await todo.execute({ todos: 'nope' }, { rootDir: '.' })).toContain('Error:');
  });
});

describe('jobs plugin', () => {
  it('lists, reads output, and stops registered jobs', async () => {
    const { host, jobs } = await activatedHost();
    const tool = host.tools.find((t) => t.name === 'jobs')!;

    jobs.start({
      kind: 'bash',
      label: 'tail -f log',
      cancel: () => {},
      done: new Promise(() => {}),
      readOutput: (() => {
        let released = false;
        return () => {
          if (released) return '';
          released = true;
          return 'booting…';
        };
      })(),
    });

    const list = await tool.execute({ action: 'list' }, { rootDir: '.', jobs });
    expect(list).toContain('bash-1');
    expect(list).toContain('tail -f log');

    const output = await tool.execute({ action: 'output', id: 'bash-1' }, { rootDir: '.', jobs });
    expect(output).toContain('booting…');

    const second = await tool.execute({ action: 'output', id: 'bash-1' }, { rootDir: '.', jobs });
    expect(second).toContain('no new output');

    const stopped = await tool.execute({ action: 'stop', id: 'bash-1' }, { rootDir: '.', jobs });
    expect(stopped).toContain('Stop requested');
  });

  it('reports missing registry and unknown ids', async () => {
    const { host } = await activatedHost();
    const tool = host.tools.find((t) => t.name === 'jobs')!;
    expect(await tool.execute({ action: 'list' }, { rootDir: '.' })).toContain('No background jobs available');
    expect(await tool.execute({ action: 'output', id: 'nope' }, { rootDir: '.', jobs: new JobRegistry() })).toContain(
      'unknown job',
    );
  });
});

describe('bash plugin', () => {
  // Requires a POSIX shell (Git Bash on Windows); PowerShell has no `sleep`.
  it.runIf(bashOnPath())('kills a command past the timeout and settles deterministically', async () => {
    const host = new PluginHost('.');
    for (const plugin of builtinPlugins({ bash: { timeoutMs: 1000 } })) host.use(plugin);
    await host.activate();
    const tool = host.tools.find((t) => t.name === 'bash')!;

    const started = Date.now();
    const result = await tool.execute({ command: 'sleep 30' }, { rootDir: '.' });
    const elapsed = Date.now() - started;

    // The timeout (1s) + tree kill + forced settle must stay far below the
    // 30s the command itself would run; close-never-fires must not hang it.
    expect(elapsed).toBeLessThan(10_000);
    expect(result).toContain('did not exit');
  }, 20_000);
});
