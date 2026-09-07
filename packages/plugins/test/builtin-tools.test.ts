import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobRegistry, type TodoItem } from '@nova-agent/core';
import { PluginHost, builtinPlugins, READ_MAX_BYTES } from '../src/index.js';
import { bashOnPath } from '../src/builtin/bash.js';

async function activatedHost(): Promise<{ host: PluginHost; jobs: JobRegistry; emitted: unknown[] }> {
  const host = new PluginHost('.');
  const jobs = new JobRegistry();
  const emitted: unknown[] = [];
  for (const plugin of builtinPlugins()) host.use(plugin);
  await host.activate();
  return { host, jobs, emitted };
}

async function fsHostAt(root: string): Promise<PluginHost> {
  const host = new PluginHost(root);
  for (const plugin of builtinPlugins()) host.use(plugin);
  await host.activate();
  return host;
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

describe('fs sandbox', () => {
  it('write_file rejects a symlink pointing outside the workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-fs-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'nova-outside-'));
    const link = path.join(root, 'escape');
    try {
      await symlink(outside, link, 'dir');
    } catch {
      // Platform without symlink privilege (Windows without dev mode) —
      // the mechanism cannot be exercised here; the guard still applies.
      return;
    }
    const host = await fsHostAt(root);
    const write = host.tools.find((t) => t.name === 'write_file')!;

    await expect(write.execute({ path: 'escape/pwned.txt', content: 'x' }, { rootDir: root })).rejects.toThrow(
      /escapes workspace root/,
    );
    // The real target must not have been created through the link.
    expect(await readFile(path.join(outside, 'pwned.txt'), 'utf8').catch(() => undefined)).toBeUndefined();
  });

  it('read_file classifies a symlinked outside path as read-external', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-fs-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'nova-outside-'));
    await writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');
    const link = path.join(root, 'sneak');
    try {
      await symlink(outside, link, 'dir');
    } catch {
      return; // no symlink privilege — nothing to assert
    }
    const host = await fsHostAt(root);
    const read = host.tools.find((t) => t.name === 'read_file')!;
    expect(await read.permissionFor?.({ path: 'sneak/secret.txt' })).toBe('read-external');
  });

  it('edit_file rejects edits of a stale snapshot (file changed since last read)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-fs-'));
    const host = await fsHostAt(root);
    const write = host.tools.find((t) => t.name === 'write_file')!;
    const read = host.tools.find((t) => t.name === 'read_file')!;
    const edit = host.tools.find((t) => t.name === 'edit_file')!;
    const file = path.join(root, 'a.txt');

    await write.execute({ path: 'a.txt', content: 'version one\nmiddle\nend' }, { rootDir: root });
    await read.execute({ path: 'a.txt' }, { rootDir: root });
    // External change between the read and the edit (user, or another tool).
    await writeFile(file, 'v2\nmiddle\nend', 'utf8');
    expect(await edit.execute({ path: 'a.txt', old_string: 'middle', new_string: 'CHANGED' }, { rootDir: root })).toContain(
      'stale',
    );

    // A fresh read resets the baseline; the identical edit now applies.
    await read.execute({ path: 'a.txt' }, { rootDir: root });
    expect(await edit.execute({ path: 'a.txt', old_string: 'middle', new_string: 'CHANGED' }, { rootDir: root })).toContain(
      '1 occurrence',
    );
    expect(await readFile(file, 'utf8')).toBe('v2\nCHANGED\nend');
  });

  it('write_file requires string content instead of silently writing empty', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-fs-'));
    const host = await fsHostAt(root);
    const write = host.tools.find((t) => t.name === 'write_file')!;
    await write.execute({ path: 'ok.txt', content: 'fine' }, { rootDir: root });
    expect(await write.execute({ path: 'ok.txt', content: { bad: true } }, { rootDir: root })).toContain(
      'Error: content must be a string',
    );
    expect(await readFile(path.join(root, 'ok.txt'), 'utf8')).toBe('fine');
  });

  it('read_file refuses oversized and binary files up front', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-fs-'));
    const host = await fsHostAt(root);
    const read = host.tools.find((t) => t.name === 'read_file')!;

    await writeFile(path.join(root, 'big.txt'), 'x'.repeat(READ_MAX_BYTES + 1), 'utf8');
    expect(await read.execute({ path: 'big.txt' }, { rootDir: root })).toContain('read cap');

    await writeFile(path.join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0xff]), { flag: 'wx' });
    expect(await read.execute({ path: 'bin.dat' }, { rootDir: root })).toContain('binary');
  });
});

describe('search_files', () => {
  it('finds content matches and name globs, skipping node_modules and dot-dirs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-search-'));
    const host = await fsHostAt(root);
    const search = host.tools.find((t) => t.name === 'search_files')!;
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
    await mkdir(path.join(root, '.git'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.ts'), 'export const answer = 42;\n', { flag: 'wx' });
    await writeFile(path.join(root, 'src', 'b.test.ts'), 'it("works", () => expect(1).toBe(1));\n', { flag: 'wx' });
    await writeFile(path.join(root, 'node_modules', 'dep', 'index.ts'), 'export const answer = 42;\n', { flag: 'wx' });
    await writeFile(path.join(root, '.git', 'config'), 'answer = 42\n', { flag: 'wx' });

    const byContent = await search.execute({ content_regex: 'answer = 42' }, { rootDir: root });
    expect(byContent).toContain('src/a.ts:1:');
    expect(byContent).not.toContain('node_modules');
    expect(byContent).not.toContain('.git');

    const byName = await search.execute({ name_glob: '**/*.test.ts' }, { rootDir: root });
    expect(byName).toBe('src/b.test.ts');
  });

  it('validates arguments and reports missing mode', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-search-'));
    const host = await fsHostAt(root);
    const search = host.tools.find((t) => t.name === 'search_files')!;
    expect(await search.execute({}, { rootDir: root })).toContain('Error: provide name_glob or content_regex');
    expect(await search.execute({ content_regex: '(' }, { rootDir: root })).toContain('Error: invalid content_regex');
    expect(await search.execute({ name_glob: '*.ts' }, { rootDir: root })).toBe('(no matches)');
  });
});

describe('approval previews', () => {
  it('renders write_file and edit_file previews without mutating anything', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-preview-'));
    const host = await fsHostAt(root);
    const write = host.tools.find((t) => t.name === 'write_file')!;
    const edit = host.tools.find((t) => t.name === 'edit_file')!;

    const writePreview = await write.preview?.({ path: 'new.txt', content: 'hello world' }, { rootDir: root });
    expect(writePreview).toContain('写入 new.txt');
    expect(writePreview).toContain('hello world');

    await write.execute({ path: 'a.txt', content: 'aaa\nbbb\nccc' }, { rootDir: root });
    const editPreview = await edit.preview?.({ path: 'a.txt', old_string: 'bbb', new_string: 'BBB' }, { rootDir: root });
    expect(editPreview).toContain('编辑 a.txt（1 处替换）');
    expect(editPreview).toContain('- bbb');
    expect(editPreview).toContain('+ BBB');
    // Preview is read-only: the file on disk is untouched.
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('aaa\nbbb\nccc');
  });
});
