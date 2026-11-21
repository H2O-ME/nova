/**
 * The shell resolution table — one answer for the model, one for the operator.
 *
 * The interesting cases are the ones this repo got wrong before: a configured
 * `pwsh.exe` handed `-c` (the old code treated ANY `shellPath` as POSIX), the
 * panel and the model disagreeing about which shell is running, and a menu row
 * for an executable that is not installed. Each test below pins one of those.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commandInvocation,
  modelShell,
  shellFamily,
  shellName,
  POWERSHELL_UTF8_PREFIX,
} from '../src/builtin/shell-select.js';

const savedPath = process.env['PATH'];

afterEach(() => {
  process.env['PATH'] = savedPath;
});

/** A temp directory holding one empty file per name, as the only PATH entry. */
async function fakeBin(...names: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nova-shell-'));
  for (const name of names) await writeFile(path.join(dir, name), '');
  return dir;
}

const suffix = (): string => (process.platform === 'win32' ? '.exe' : '');

describe('shellFamily / shellName', () => {
  it('reads the family from the file name, not from where it came from', () => {
    expect(shellFamily('pwsh')).toBe('pwsh');
    expect(shellFamily('C:/Program Files/PowerShell/7/pwsh.exe')).toBe('pwsh');
    expect(shellFamily('powershell.exe')).toBe('powershell');
    expect(shellFamily('cmd.exe')).toBe('cmd');
    expect(shellFamily('/usr/local/bin/bash')).toBe('posix');
    expect(shellFamily('zsh')).toBe('posix');
  });

  it('drops the extension for the display name', () => {
    expect(shellName('/x/pwsh.EXE')).toBe('pwsh');
    expect(shellName('bash')).toBe('bash');
  });
});

describe('commandInvocation', () => {
  it('runs POSIX shells with -c and honors the configured binary', () => {
    expect(commandInvocation('posix', 'ls')).toEqual({
      cmd: process.platform === 'win32' ? 'bash.exe' : 'bash', args: ['-c', 'ls'],
    });
    expect(commandInvocation('posix', 'ls', '/opt/bash').cmd).toBe('/opt/bash');
  });

  it('runs both PowerShell families with no profile and the UTF-8 statement first', () => {
    for (const [family, cmd] of [['pwsh', 'pwsh.exe'], ['powershell', 'powershell.exe']] as const) {
      const inv = commandInvocation(family, 'Get-ChildItem');
      expect(inv.cmd).toBe(cmd);
      expect(inv.args[0]).toBe('-NoProfile');
      const script = inv.args[2] ?? '';
      expect(script.startsWith(POWERSHELL_UTF8_PREFIX)).toBe(true);
      expect(script.endsWith('Get-ChildItem')).toBe(true);
    }
  });

  it('runs cmd with the switch trio so quoting stays the command’s own', () => {
    const inv = commandInvocation('cmd', 'echo hi');
    expect(inv.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(inv.args[3]).toBe('echo hi');
  });
});

describe('modelShell', () => {
  it('a configured pwsh is a PowerShell, not a POSIX shell with a new name', async () => {
    const pwsh = path.join(await fakeBin(`pwsh${suffix()}`), `pwsh${suffix()}`);
    const shell = modelShell(pwsh);
    expect(shell.family).toBe('pwsh');
    expect(commandInvocation(shell.family, 'x', shell.path).args[0]).toBe('-NoProfile');
  });

  it('prefers PowerShell 7, then Git Bash, then Windows PowerShell', async () => {
    if (process.platform !== 'win32') {
      expect(modelShell(undefined).family).toBe('posix');
      return;
    }
    const both = await fakeBin('pwsh.exe', 'bash.exe', 'powershell.exe');
    process.env['PATH'] = both;
    expect(modelShell(undefined).name).toBe('pwsh');
    process.env['PATH'] = await fakeBin('bash.exe', 'powershell.exe');
    expect(modelShell(undefined).name).toBe('bash');
    process.env['PATH'] = await fakeBin('powershell.exe');
    expect(modelShell(undefined).name).toBe('powershell');
  });
});
