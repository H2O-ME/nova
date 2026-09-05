/** 系统级通知：终端在前台之外也能知道 agent 要审批、已完成或出错了。 */

import { spawn, type ChildProcess } from 'node:child_process';

export type Notifier = (title: string, body: string) => void;

export interface NotifierOptions {
  /** config.notify !== false 时开启；环境变量 NOVA_NO_NOTIFY=1 强制关闭。 */
  enabled?: boolean;
  /** 两次通知的最小间隔（防刷屏）。默认 4000ms。 */
  minIntervalMs?: number;
}

/**
 * Create a fire-and-forget notifier. Only fires when stdout is a TTY (the
 * user actually "left" an interactive session); every failure path is silent
 * — a toast must never take the session down.
 */
export function createNotifier(options?: NotifierOptions): Notifier {
  const enabled =
    options?.enabled !== false &&
    process.stdout.isTTY === true &&
    process.env['NOVA_NO_NOTIFY'] === undefined;
  const minIntervalMs = options?.minIntervalMs ?? 4000;
  let lastAt = 0;
  let lastBody = '';
  return (title, body) => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastAt < minIntervalMs || body === lastBody) return;
    lastAt = now;
    lastBody = body;
    try {
      dispatch(title, body);
    } catch {
      // 通知失败不影响主流程。
    }
  };
}

function dispatch(title: string, body: string): void {
  if (process.platform === 'win32') {
    runDetached('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', buildWindowsToastScript(title, body)], 15_000);
    return;
  }
  if (process.platform === 'darwin') {
    runDetached('osascript', ['-e', `display notification ${quoteApple(body)} with title ${quoteApple(title)}`], 10_000);
    return;
  }
  runDetached('notify-send', [title, body, '--expire-time=6000'], 10_000);
}

function runDetached(cmd: string, args: string[], timeoutMs: number): void {
  let child: ChildProcess;
  try {
    child = spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore' });
  } catch {
    return;
  }
  // ENOENT (notify-send missing etc.) arrives asynchronously — swallow it.
  child.on('error', () => undefined);
  const timer = setTimeout(() => {
    child.kill();
  }, timeoutMs);
  timer.unref();
  child.unref();
}

/**
 * Windows 10/11 toast via Windows PowerShell 5.1 WinRT (always present, no
 * dependencies). WinRT toasts need an AppUserModelID; borrowing the bundled
 * PowerShell AUMID is the standard dependency-free trick. On systems where
 * WinRT projection fails, fall back to a NotifyIcon balloon tip (renders as
 * a toast on modern Windows).
 */
export function buildWindowsToastScript(title: string, body: string): string {
  const t = psQuote(title);
  const b = psQuote(body);
  return [
    `$t='${t}'; $b='${b}'`,
    'try {',
    '  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null',
    '  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null',
    '  $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    "  $texts = $xml.GetElementsByTagName('text')",
    '  $texts.Item(0).AppendChild($xml.CreateTextNode($t)) | Out-Null',
    '  $texts.Item(1).AppendChild($xml.CreateTextNode($b)) | Out-Null',
    '  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
    "  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)",
    '} catch {',
    '  Add-Type -AssemblyName System.Windows.Forms',
    '  Add-Type -AssemblyName System.Drawing',
    '  $n = New-Object System.Windows.Forms.NotifyIcon',
    '  $n.Icon = [System.Drawing.SystemIcons]::Information',
    '  $n.Visible = $true',
    '  $n.ShowBalloonTip(5000, $t, $b, [System.Windows.Forms.ToolTipIcon]::Info)',
    '  Start-Sleep -Seconds 3',
    '  $n.Dispose()',
    '}',
  ].join('\n');
}

/** PowerShell 单引号字符串转义；换行压成空格（XML 文本节点不接受原始换行）。 */
function psQuote(text: string): string {
  return text.replace(/\s+/g, ' ').replaceAll("'", "''");
}

function quoteApple(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replaceAll('"', '\\"')}"`;
}
