/**
 * The terminal's shell choice (`rightbar/terminal-shell.ts`).
 *
 * The killing rule: **a remembered path for a shell the host no longer lists
 * falls back to the host's current row** — the wire must never carry a name the
 * picker could not have shown, or the host's refusal ("不在已安装清单里")
 * becomes a boot-time surprise instead of a picked-shell guarantee.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  readShellPreference,
  requestedShell,
  SHELL_STORAGE_KEY,
  writeShellPreference,
} from '../src/rightbar/terminal-shell.js';

/** Install a minimal `window.localStorage` for one test. */
function stubStorage(initial: Record<string, string> = {}): Record<string, string> {
  const store: Record<string, string> = { ...initial };
  const target = globalThis as { window?: unknown };
  target.window = {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
    },
  };
  return store;
}

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

const SHELLS = [
  { path: 'C:/Windows/system32/cmd.exe' },
  { path: 'C:/Program Files/PowerShell/7/pwsh.exe' },
];

describe('terminal shell preference', () => {
  it('sends the remembered shell while the host still lists it', () => {
    expect(requestedShell(SHELLS, SHELLS[0]?.path ?? '', SHELLS[1]?.path ?? '')).toBe(
      'C:/Program Files/PowerShell/7/pwsh.exe',
    );
  });

  it('matches the remembered path case-insensitively but sends the canonical row', () => {
    // Windows spells the same executable with different casing across calls;
    // the host's own row is what a future comparison must see again.
    expect(requestedShell(SHELLS, SHELLS[0]?.path ?? '', 'c:/program files/powershell/7/pwsh.exe')).toBe(
      'C:/Program Files/PowerShell/7/pwsh.exe',
    );
  });

  it('falls back to the host default when the remembered shell is gone', () => {
    // The killing case: pwsh uninstalled since the choice was made.
    expect(requestedShell([SHELLS[0] ?? { path: 'x' }], SHELLS[0]?.path ?? '', SHELLS[1]?.path ?? '')).toBe(
      'C:/Windows/system32/cmd.exe',
    );
  });

  it('no choice stored means the host default, verbatim', () => {
    expect(requestedShell(SHELLS, SHELLS[0]?.path ?? '', null)).toBe('C:/Windows/system32/cmd.exe');
  });

  it('round-trips through storage and survives its absence', () => {
    const store = stubStorage();
    writeShellPreference('C:/Program Files/PowerShell/7/pwsh.exe');
    expect(store[SHELL_STORAGE_KEY]).toBe('C:/Program Files/PowerShell/7/pwsh.exe');
    expect(readShellPreference()).toBe('C:/Program Files/PowerShell/7/pwsh.exe');
    // A browser that refuses storage still gets a working terminal: no window
    // reads as no preference, and writing is a no-op rather than a throw.
    delete (globalThis as { window?: unknown }).window;
    expect(readShellPreference()).toBe(null);
    expect(() => { writeShellPreference('x'); }).not.toThrow();
  });
});
