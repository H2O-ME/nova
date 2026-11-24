import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandHookVars, hookSpawnSpec, hookTimeoutMs, runHook } from '@nova-agent/plugins';
import type { HookDefinition } from '@nova-agent/core';

/**
 * Executing one configured hook: variable expansion, the timeout resolution,
 * and the real spawn path (exit codes, stdout capture, `additionalContext`).
 * The spawn cases run a real `node -e`, because the contract being protected is
 * "a hook process's stdout becomes a verdict" — mocking spawn would test the
 * mock.
 */
describe('hook variable expansion', () => {
  const env = { pluginRoot: '/packs/demo', projectDir: '/work' };

  it('resolves every host-root spelling a pack may use', () => {
    expect(expandHookVars('${ZCODE_PLUGIN_ROOT}/h.js', env)).toBe('/packs/demo/h.js');
    expect(expandHookVars('${CLAUDE_PLUGIN_ROOT}/h.js', env)).toBe('/packs/demo/h.js');
    expect(expandHookVars('${NOVA_PLUGIN_ROOT}/h.js', env)).toBe('/packs/demo/h.js');
    expect(expandHookVars('${CLAUDE_PROJECT_DIR}', env)).toBe('/work');
  });

  it('leaves an unknown reference verbatim rather than emptying it', () => {
    // A shell script's own `${BASH_SOURCE}` must not silently become "".
    expect(expandHookVars('${BASH_SOURCE}', env)).toBe('${BASH_SOURCE}');
  });

  it('expands declared extra vars', () => {
    expect(expandHookVars('${engine}', env, { engine: 'native' })).toBe('native');
  });
});

describe('hook timeout resolution', () => {
  it('prefers timeoutMs, then Claude-style seconds, then the default', () => {
    const process: HookDefinition = { type: 'process', command: 'x', timeoutMs: 500 };
    const command: HookDefinition = { type: 'command', command: 'x', timeout: 2 };
    const bare: HookDefinition = { type: 'process', command: 'x' };
    expect(hookTimeoutMs(process, 9999)).toBe(500);
    expect(hookTimeoutMs(command, 9999)).toBe(2000);
    expect(hookTimeoutMs(bare, 9999)).toBe(9999);
  });
});

describe('hook spawn spec', () => {
  it('runs process hooks as argv (no shell) and command hooks through a shell', () => {
    const env = { pluginRoot: '/p', projectDir: '/w' };
    const process = hookSpawnSpec({ type: 'process', command: 'node', args: ['a.js'] }, env);
    expect(process).toEqual({ command: 'node', args: ['a.js'], shell: false });
    const command = hookSpawnSpec({ type: 'command', command: 'sh ./x.sh' }, env);
    expect(command.shell).toBe(true);
  });
});

describe('runHook', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'nova-hook-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('captures stdout JSON and its parsed output', async () => {
    const script = path.join(dir, 'echo.mjs');
    await writeFile(
      script,
      'process.stdin.resume();process.stdin.on("end", () => process.stdout.write(JSON.stringify({decision:"block",reason:"nope"})));\n',
    );
    const outcome = await runHook(
      { type: 'process', command: process.execPath, args: [script] },
      { env: { projectDir: dir }, payload: { cwd: dir, hookEventName: 'Stop' } },
    );
    expect(outcome.exitCode).toBe(0);
    expect(outcome.output?.decision).toBe('block');
    expect(outcome.output?.reason).toBe('nope');
    expect(outcome.failure).toBeUndefined();
  });

  it('reads the payload off stdin (the hook sees the event name)', async () => {
    const script = path.join(dir, 'read.mjs');
    await writeFile(
      script,
      'let buf="";process.stdin.on("data",c=>buf+=c);process.stdin.on("end",()=>{const p=JSON.parse(buf);process.stdout.write(JSON.stringify({decision:"approve",reason:p.hookEventName}))});\n',
    );
    const outcome = await runHook(
      { type: 'process', command: process.execPath, args: [script] },
      { env: { projectDir: dir }, payload: { cwd: dir, hookEventName: 'SessionStart' } },
    );
    expect(outcome.output?.reason).toBe('SessionStart');
  });

  it('reports exit code 2 as a normal outcome (the caller reads it as block)', async () => {
    const script = path.join(dir, 'block.mjs');
    await writeFile(script, 'process.exit(2);\n');
    const outcome = await runHook(
      { type: 'process', command: process.execPath, args: [script] },
      { env: { projectDir: dir }, payload: { cwd: dir, hookEventName: 'PreToolUse' } },
    );
    expect(outcome.exitCode).toBe(2);
    expect(outcome.failure).toBeUndefined();
  });

  it('reports a non-zero exit and a timeout as failures without throwing', async () => {
    const bad = path.join(dir, 'bad.mjs');
    await writeFile(bad, 'process.exit(7);\n');
    const failed = await runHook(
      { type: 'process', command: process.execPath, args: [bad] },
      { env: { projectDir: dir }, payload: { cwd: dir, hookEventName: 'Stop' } },
    );
    expect(failed.exitCode).toBe(7);
    expect(failed.failure).toContain('exit code 7');

    const slow = path.join(dir, 'slow.mjs');
    await writeFile(slow, 'setTimeout(()=>{},60000);\n');
    const timedOut = await runHook(
      { type: 'process', command: process.execPath, args: [slow], timeoutMs: 150 },
      { env: { projectDir: dir }, payload: { cwd: dir, hookEventName: 'Stop' } },
    );
    expect(timedOut.failure).toContain('timed out');
  });

  it('reports a spawn failure (a missing binary) as an outcome', async () => {
    const outcome = await runHook(
      { type: 'process', command: path.join(dir, 'no-such-binary') },
      { env: { projectDir: dir }, payload: { cwd: dir, hookEventName: 'Stop' }, defaultTimeoutMs: 1000 },
    );
    expect(outcome.failure).toContain('spawn failed');
  });

  it('truncates stdout at the byte cap', async () => {
    const script = path.join(dir, 'flood.mjs');
    await writeFile(script, 'process.stdout.write("x".repeat(10000));\n');
    const outcome = await runHook(
      { type: 'process', command: process.execPath, args: [script] },
      { env: { projectDir: dir }, payload: { cwd: dir, hookEventName: 'Stop' }, maxOutputBytes: 100 },
    );
    expect(Buffer.byteLength(outcome.stdout, 'utf8')).toBeLessThanOrEqual(100);
  });
});
