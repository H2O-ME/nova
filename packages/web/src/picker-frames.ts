/**
 * The frames that open a NATIVE dialog on the host: `pick_file` names one file
 * for an `@` reference, `pick_directory` names one workspace folder.
 *
 * They exist because the browser cannot produce an absolute path (`File.path`
 * is an Electron extension), and both consumers need exactly that path. The
 * host can — see `native-picker.ts` — and the answer rides one server frame:
 * `picked` with the path, or without one plus a reason when this host has no
 * dialog to open (the client then falls back to its in-page browser). A bare
 * `picked` with neither is a cancel, and means "nothing happened" on purpose.
 */
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';
import type { PickKind, PickerOutcome } from './native-picker.js';

/** How the host opens a dialog (the real one by default; injected in tests). */
export type PickFn = (kind: PickKind) => Promise<PickerOutcome>;

/**
 * Answer one pick frame. The reply goes to the asking socket only — a second
 * browser window picking its own file must not see this dialog's outcome.
 * @param client - the socket the frame arrived on.
 * @param frame - the validated frame.
 * @param pick - the dialog opener.
 */
export async function handlePickerFrame(
  client: WsConnection,
  frame: Extract<ClientFrame, { type: 'pick_file' | 'pick_directory' }>,
  pick: PickFn,
): Promise<void> {
  const kind: PickKind = frame.type === 'pick_file' ? 'file' : 'directory';
  const outcome = await pick(kind);
  client.send(serialize({
    type: 'picked',
    kind,
    ...(outcome.status === 'picked' ? { path: outcome.path } : {}),
    ...(outcome.status === 'unavailable' ? { error: outcome.reason } : {}),
  }));
}
