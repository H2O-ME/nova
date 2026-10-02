/**
 * The terminal's shell choice: which row of the host's `shells` answer a
 * `term_open` asks for.
 *
 * Ported in shape from dsh `terminal-controller`'s client shell preference
 * (MIT): the host discovers what is installed and answers with the default
 * first; the BROWSER remembers the row the reader picked, and every new
 * terminal asks for it by path. The host validates the path against its own
 * discovery — a remembered path for a shell that has since been uninstalled
 * falls back to the host's current row here, so the wire never carries a name
 * the menu does not show.
 *
 * Pure: no React, no DOM beyond the storage accessors' try/catch (a browser
 * that refuses storage gets the host default every time, which is correct).
 */

/** Where the remembered shell lives (versioned: a future shape takes a new key). */
export const SHELL_STORAGE_KEY = 'nova.terminal.shell.v1';

/**
 * The remembered shell path, or null when no choice is stored.
 * @returns the stored path, or null.
 */
export function readShellPreference(): string | null {
  try {
    const stored = window.localStorage.getItem(SHELL_STORAGE_KEY);
    return typeof stored === 'string' && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Remember the shell the reader picked.
 * @param path - the shell's path, as the host's `shells` answer spelled it.
 */
export function writeShellPreference(path: string): void {
  try {
    window.localStorage.setItem(SHELL_STORAGE_KEY, path);
  } catch {
    // A browser that refuses storage still gets a working terminal; the
    // preference is a convenience, not a dependency.
  }
}

/**
 * The path a `term_open` should carry.
 *
 * A remembered choice is honored only while the host still lists it (Windows
 * spells the same executable with different casing across calls, so the match
 * is case-insensitive and the CANONICAL row path is what goes on the wire).
 * Anything else — no choice made, a stale path for an uninstalled shell —
 * resolves to the host's current row, so the terminal that opens is always one
 * the menu could have shown.
 * @param items - the host's discovered shells.
 * @param current - the host's own default (the `shells.current` path).
 * @param preferred - the remembered path, or null.
 * @returns the path to send.
 */
export function requestedShell(
  items: readonly { path: string }[],
  current: string,
  preferred: string | null,
): string {
  if (preferred === null) return current;
  const match = items.find((item) => item.path.toLowerCase() === preferred.toLowerCase());
  return match?.path ?? current;
}
