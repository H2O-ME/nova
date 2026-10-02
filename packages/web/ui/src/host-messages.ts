/**
 * The one host error that is not the client's to fix, and how it is phrased.
 *
 * `unknown frame type: X` on a frame this bundle just sent means the RUNNING
 * host process is not the build that served this page: the server reads its
 * static assets from disk on every request, so a rebuilt `packages/web/public`
 * under a process started earlier answers the new frames with this rejection —
 * and will keep doing so for as long as it runs, which is why it reads as
 * 「经常报错」. The raw message names a frame, which is a protocol fact; the
 * reader needs the fix: restart nova so both halves are the same build again.
 * @param message - the host's error-frame message, verbatim.
 * @returns the text the hint shows.
 */
export function hostErrorText(message: string): string {
  if (message.startsWith('unknown frame type: ')) {
    return '宿主提示：界面比正在运行的 nova 进程新（宿主不认识界面发送的帧）。请停止当前 nova 进程并重新启动，让宿主与界面回到同一份构建。';
  }
  return `宿主提示：${message}`;
}
