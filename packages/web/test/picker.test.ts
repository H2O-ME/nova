/**
 * The native file/folder picker (`native-picker.ts` + `picker-frames.ts`).
 *
 * The contract under test: the host opens a REAL dialog (spawned, not
 * emulated), reads the selection back, and answers exactly one `picked` frame
 * whose three readings are distinct — path set means picked, `error` set means
 * no dialog on this host (fall back to the in-page browser), neither set means
 * the operator dismissed it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseClientFrame } from '../src/client-frame.js';
import { pickNativePath, type SpawnLike } from '../src/native-picker.js';
import { handlePickerFrame } from '../src/picker-frames.js';
import type { ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';

/** A child process whose stdout, `error` and `close` the test drives by hand. */
class ScriptedChild {
  private readonly listeners = new Map<string, ((arg?: unknown) => void)[]>();
  private stdoutCb: ((chunk: Buffer) => void) | undefined;
  readonly stdout = {
    on: (_event: string, cb: (chunk: Buffer) => void): void => { this.stdoutCb = cb; },
  };
  write(text: string): void { this.stdoutCb?.(Buffer.from(text, 'utf8')); }
  on(event: string, cb: (arg?: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
  }
  emit(event: string, arg?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(arg);
  }
}

interface SpawnRecord {
  command: string;
  args: readonly string[];
}

function rig(child: ScriptedChild): { spawns: SpawnRecord[]; spawn: SpawnLike } {
  const spawns: SpawnRecord[] = [];
  const spawnLike: SpawnLike = (command, args) => {
    spawns.push({ command, args });
    return child as unknown as ChildProcess;
  };
  return { spawns, spawn: spawnLike };
}

/**
 * The Windows script as the child actually receives it: `-EncodedCommand`
 * carries it base64-encoded (UTF-16LE), so the assertions below read the
 * decoded text — the encoding itself is asserted once, here.
 * @param args - the spawned argument list.
 * @returns the script text PowerShell will run.
 */
function scriptOf(args: readonly string[]): string {
  expect(args).toContain('-EncodedCommand');
  expect(args.join(' ')).not.toContain('选择要引用的文件');
  const encoded = args.at(-1) ?? '';
  // base64 only: nothing in the script may ride the command line as text.
  expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/u);
  const text = Buffer.from(encoded, 'base64').toString('utf16le');
  expect(text).toContain('$ErrorActionPreference');
  return text;
}

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  send(text: string): void { this.frames.push(JSON.parse(text) as ServerFrame); }
  close(): void {}
}

describe('native-picker', () => {
  it('windows: the file dialog is PowerShell + OpenFileDialog, path read back', async () => {
    const child = new ScriptedChild();
    const { spawns, spawn: spawnLike } = rig(child);
    const pending = pickNativePath('file', { spawn: spawnLike, platform: 'win32' });
    child.write('D:\\notes\\报告.md');
    child.emit('close');
    await expect(pending).resolves.toEqual({ status: 'picked', path: 'D:\\notes\\报告.md' });
    expect(spawns[0]?.command).toBe('powershell.exe');
    expect(spawns[0]?.args).toContain('-STA');
    expect(scriptOf(spawns[0]?.args ?? [])).toContain('OpenFileDialog');
    // A path with CJK characters survives the pipe only as UTF-8.
    expect(scriptOf(spawns[0]?.args ?? [])).toContain('OutputEncoding');
    // A background process has no foreground rights, so without the raise the
    // dialog opens BEHIND the browser — the user's "nothing happened" — for the
    // FOLDER dialog too (the legacy FolderBrowserDialog never activates on its
    // own). The fix re-raises our own dialog from inside the modal loop.
    expect(scriptOf(spawns[0]?.args ?? [])).toContain('[Win32.Pick]::Raise($target)');
    expect(scriptOf(spawns[0]?.args ?? [])).toContain('SetWindowPos');
    // A synthesized Alt press is how dsh does it, and it is deliberately NOT
    // ours: the keystroke lands in whatever window has focus, and in Firefox
    // that pops the classic menu bar. Nothing here may inject input.
    expect(scriptOf(spawns[0]?.args ?? [])).not.toContain('keybd_event');
  });
  it('windows: the folder dialog is FolderBrowserDialog, and it is raised like the file one', async () => {
    const child = new ScriptedChild();
    const { spawns, spawn: spawnLike } = rig(child);
    const pending = pickNativePath('directory', { spawn: spawnLike, platform: 'win32' });
    child.write('D:\\code');
    child.emit('close');
    await expect(pending).resolves.toEqual({ status: 'picked', path: 'D:\\code' });
    expect(scriptOf(spawns[0]?.args ?? [])).toContain('FolderBrowserDialog');
    // The folder dialog is the one that stayed invisible: it needs the same
    // raise, asserted here so the two kinds cannot drift apart.
    expect(scriptOf(spawns[0]?.args ?? [])).toContain('[Win32.Pick]::Raise($target)');
  });
  it('a dismissed dialog (no output) is a cancel, not an error', async () => {
    const child = new ScriptedChild();
    const { spawn: spawnLike } = rig(child);
    const pending = pickNativePath('file', { spawn: spawnLike, platform: 'win32' });
    child.emit('close');
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
  });
  it('no dialog runner on this host is `unavailable`, with the reason', async () => {
    const child = new ScriptedChild();
    const { spawn: spawnLike } = rig(child);
    const pending = pickNativePath('file', { spawn: spawnLike, platform: 'linux' });
    child.emit('error', new Error('spawn zenity ENOENT'));
    const outcome = await pending;
    expect(outcome.status).toBe('unavailable');
    expect(outcome.status !== 'picked' && outcome.status !== 'cancelled' ? outcome.reason : '').toContain('ENOENT');
  });
  it('posix: zenity, with --directory for folders', async () => {
    const child = new ScriptedChild();
    const { spawns, spawn: spawnLike } = rig(child);
    const pending = pickNativePath('directory', { spawn: spawnLike, platform: 'linux' });
    child.write('/home/user/code\n');
    child.emit('close');
    await expect(pending).resolves.toEqual({ status: 'picked', path: '/home/user/code' });
    expect(spawns[0]?.command).toBe('zenity');
    expect(spawns[0]?.args).toContain('--file-selection');
    expect(spawns[0]?.args).toContain('--directory');
  });
  it('the real spawn is reachable (defaults wired, no dialog actually opened here)', () => {
    expect(typeof spawn).toBe('function');
  });
});

describe('picker frames', () => {
  it('pick_file answers with the picked path', async () => {
    const conn = new FakeConn();
    await handlePickerFrame(conn, { type: 'pick_file' }, async () => ({ status: 'picked', path: 'C:\\a.txt' }));
    expect(conn.frames).toEqual([{ type: 'picked', kind: 'file', path: 'C:\\a.txt' }]);
  });
  it('pick_directory maps to kind directory', async () => {
    const conn = new FakeConn();
    await handlePickerFrame(conn, { type: 'pick_directory' }, async () => ({ status: 'picked', path: '/srv' }));
    expect(conn.frames).toEqual([{ type: 'picked', kind: 'directory', path: '/srv' }]);
  });
  it('unavailable carries the reason so the client can fall back', async () => {
    const conn = new FakeConn();
    await handlePickerFrame(conn, { type: 'pick_directory' }, async () => ({
      status: 'unavailable',
      reason: 'spawn zenity ENOENT',
    }));
    expect(conn.frames).toEqual([{ type: 'picked', kind: 'directory', error: 'spawn zenity ENOENT' }]);
  });
  it('a cancel is a bare frame — neither path nor error', async () => {
    const conn = new FakeConn();
    await handlePickerFrame(conn, { type: 'pick_file' }, async () => ({ status: 'cancelled' }));
    expect(conn.frames).toEqual([{ type: 'picked', kind: 'file' }]);
  });
  it('the wire accepts both pick frames with no fields', () => {
    expect(parseClientFrame('{"type":"pick_file"}')).toEqual({ type: 'pick_file' });
    expect(parseClientFrame('{"type":"pick_directory"}')).toEqual({ type: 'pick_directory' });
  });
});
