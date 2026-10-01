/**
 * The shell's NATIVE-dialog seam: ask the host for a real path and land the
 * `picked` reply on the same two seams the in-page browser's answers use.
 *
 * The ask and its reply are frames, so the fold lives beside the reducer's
 * state: `pickPending` guards against a second modal (two open dialogs would
 * let two replies race for one seat), and the reply's three readings route to
 * three callbacks — a file path rails a reference, a directory path adopts a
 * workspace, and an `error` means this host has no dialog to open, so the
 * caller falls back to the in-page browser. Neither field is the cancel
 * reading, and cancel lands nowhere on purpose.
 */
import { useCallback, useEffect } from 'react';
import type { ClientFrame } from '../../../src/protocol';
import { basename } from '../composer/file-type.js';
import type { PickReply } from '../state.js';

/** Ask for one native dialog, one at a time. */
export function useNativePick(options: {
  /** Put a pick frame on the socket. */
  send: (frame: ClientFrame) => void;
  /** True while a `picked` reply is still owed (the second ask is dropped). */
  pickPending: boolean;
  /** The last `picked` frame, or null. */
  pick: PickReply | null;
  /** A file was named — rail it as an `@` reference. */
  onFile: (path: string, name: string) => void;
  /** A folder was named — adopt it as the workspace root. */
  onDirectory: (path: string) => void;
  /** The host has no native dialog — open the in-page browser for this kind. */
  onFallback: (kind: 'file' | 'directory') => void;
}): (kind: 'file' | 'directory') => void {
  const { send, pickPending, pick, onFile, onDirectory, onFallback } = options;
  const pickNative = useCallback(
    (kind: 'file' | 'directory'): void => {
      if (pickPending) return;
      send({ type: kind === 'file' ? 'pick_file' : 'pick_directory' });
    },
    [send, pickPending],
  );
  useEffect(() => {
    if (pick === null) return;
    if (pick.path !== undefined) {
      if (pick.kind === 'file') onFile(pick.path, basename(pick.path));
      else onDirectory(pick.path);
    } else if (pick.error !== undefined) {
      onFallback(pick.kind);
    }
  }, [pick, onFile, onDirectory, onFallback]);
  return pickNative;
}
