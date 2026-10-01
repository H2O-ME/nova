/**
 * The host's native file/folder dialogs: the one route to a REAL absolute path.
 *
 * A browser tab cannot name where a file lives — `showFilePicker()` resolves a
 * handle with no `path` (that field is an Electron extension), and an `@`
 * reference or a workspace root needs exactly that path. But this server runs
 * ON the user's machine, behind the same launch-token authentication as every
 * other mutating frame, so the host itself can open the operating system's own
 * dialog and read the selection back from the child's stdout:
 *
 *  - Windows: PowerShell (always present) hosting the WinForms
 *    `OpenFileDialog` / `FolderBrowserDialog` — zero third-party dependencies,
 *    the same stance as this package's hand-rolled WebSocket.
 *  - POSIX: `zenity --file-selection` when installed.
 *  - Neither available: `{status: 'unavailable'}` and the client falls back to
 *    its in-page browser — a missing dialog degrades, never fails.
 *
 * The dialog is modal and user-paced, so the child gets no timeout: a run that
 * cannot finish until the operator clicks is not a hang. Cancel and empty
 * output are the SAME outcome (the dialog writes nothing when dismissed).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { errMessage } from '@nova-agent/core';

/** What the operator is asked to name. */
export type PickKind = 'file' | 'directory';

/**
 * One ask's outcome. Three states on purpose: `picked` carries the path, and
 * `cancelled` (the dialog was dismissed) must stay distinct from `unavailable`
 * (the host has no dialog to open) — the first means "the user said no", the
 * second means the client should fall back to its in-page browser.
 */
export type PickerOutcome =
  | { status: 'picked'; path: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string };

/** The slice of `child_process` the picker needs (injected in tests). */
export type SpawnLike = (command: string, args: readonly string[]) => ChildProcess;

/**
 * A dialog opened by a background process opens BEHIND the browser: the host
 * has no foreground rights, so the chooser the user just asked for sits
 * invisible behind the very window they clicked in (measured: without this
 * the screen shows only the browser).
 *
 * dsh's `win32-dialog-worker` solves it by synthesizing an Alt press before
 * `Show` — measured here to work, and REJECTED: a synthetic Alt lands in
 * whatever window has the focus, and in Firefox that pops the classic menu
 * bar (the user's "旧版火狐菜单栏"). Ours instead re-raises its OWN dialog:
 * a WinForms timer, inside the modal message loop, finds this process's
 * `#32770` window and calls `SetWindowPos(HWND_TOPMOST)` + `SetForegroundWindow`
 * on it. Polling is required, not decorative: the dialog window is created
 * some time after `ShowDialog` is entered, so a single early attempt misses it.
 */
const RAISE_DIALOG_LINES: readonly string[] = [
  "Add-Type -Namespace Win32 -Name Pick -MemberDefinition 'public delegate bool EnumProc(IntPtr h, IntPtr l); [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc cb, IntPtr l); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h); [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder sb, int max); [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); public static void Raise(int pid) { EnumWindows((h, l) => { uint owner; GetWindowThreadProcessId(h, out owner); if ((int)owner != pid) return true; if (!IsWindowVisible(h)) return true; var sb = new System.Text.StringBuilder(64); GetClassNameW(h, sb, 64); if (sb.ToString() != \"#32770\") return true; SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x43); SetForegroundWindow(h); return true; }, IntPtr.Zero); }'",
  '$target = $PID',
  '$ticks = 0',
  '$timer = New-Object System.Windows.Forms.Timer',
  '$timer.Interval = 120',
  // Fourteen ticks ≈ 1.7s: long enough to outlast window creation, short
  // enough to stop before the operator has finished reading the dialog.
  '$timer.Add_Tick({ [Win32.Pick]::Raise($target); $script:ticks += 1; if ($script:ticks -ge 14) { $timer.Stop() } })',
  '$timer.Start()',
];

/** Stop the raise timer once the dialog returned (its work is done either way). */
const STOP_RAISE_TIMER = '$timer.Stop()';

/**
 * Windows PowerShell script per kind. Output goes through
 * `[Console]::OutputEncoding` → UTF-8 so a path with CJK characters survives
 * the pipe (the console's default codepage would mangle it), and is written
 * with `Out.Write` — no trailing newline to trim variants of. The raise timer
 * (see `RAISE_DIALOG_LINES`) runs around `ShowDialog`.
 */
const WINDOWS_SCRIPTS: Readonly<Record<PickKind, string>> = {
  file: [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    ...RAISE_DIALOG_LINES,
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Title = '选择要引用的文件'",
    '$d.CheckFileExists = $true',
    '$d.DereferenceLinks = $true',
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }",
    STOP_RAISE_TIMER,
  ].join('; '),
  directory: [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    ...RAISE_DIALOG_LINES,
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = '选择工作区文件夹'",
    '$d.ShowNewFolderButton = $true',
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
    STOP_RAISE_TIMER,
  ].join('; '),
};

/**
 * Open one native dialog and read the selection back.
 * @param kind - whether to ask for a file or a folder.
 * @param deps - the platform and the spawn (defaults: this process, `node:child_process`).
 * @returns the outcome — never throws: a dialog that cannot open is an answer.
 */
export async function pickNativePath(
  kind: PickKind,
  deps?: { spawn?: SpawnLike; platform?: string },
): Promise<PickerOutcome> {
  const platform = deps?.platform ?? process.platform;
  const spec = platform === 'win32'
    ? {
        command: 'powershell.exe',
        // `-EncodedCommand` (base64 of the UTF-16LE script) rather than
        // `-Command`: the script carries Chinese titles, and this form is the
        // one PowerShell itself defines to be immune to how a command line is
        // quoted, escaped or re-encoded on the way in. Nothing here depends on
        // the console's code page.
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-EncodedCommand',
          Buffer.from(WINDOWS_SCRIPTS[kind], 'utf16le').toString('base64'),
        ],
      }
    : {
        command: 'zenity',
        args: kind === 'directory'
          ? ['--file-selection', '--directory']
          : ['--file-selection'],
      };
  return new Promise<PickerOutcome>((resolve) => {
    let out = '';
    let settled = false;
    const settle = (outcome: PickerOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    let child: ChildProcess;
    try {
      child = (deps?.spawn ?? spawn)(spec.command, spec.args);
    } catch (err) {
      settle({ status: 'unavailable', reason: errMessage(err) });
      return;
    }
    // "No dialog on this machine" is `zenity` being absent (or PowerShell being
    // unlaunchable) — a fallback instruction, not an error for the reader.
    child.on('error', (err: unknown) => { settle({ status: 'unavailable', reason: errMessage(err) }); });
    child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.on('close', () => {
      const picked = out.trim();
      // A dismissed dialog writes nothing (zenity exits non-zero, WinForms
      // prints nothing) — cancel, not failure.
      settle(picked === '' ? { status: 'cancelled' } : { status: 'picked', path: picked });
    });
  });
}
