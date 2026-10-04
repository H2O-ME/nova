/**
 * The browser↔plugin seam: ONE frame pair for every plugin.
 *
 * A plugin that owns a settings page, a runtime readout or a probe registers a
 * namespace with core's `plugin-rpc` service and answers here. The host is
 * deliberately not in the conversation — it neither knows the plugin nor
 * validates the operation — so a new plugin ships a page without a host change.
 *
 * This replaced a hand-written family per first-party plugin (`qqbot` /
 * `save_qqbot` / `test_qqbot` plus a typed snapshot, a runtime interface and a
 * persister threaded through the controller). Those three frames were the reason
 * "add a plugin" meant editing `web`, `cli` and the browser: each new plugin's
 * page needed its own frame name, its own validator case, its own host port and
 * its own section in the settings nav. The generic pair below has none of that.
 *
 * ## Failure is an answer, not a transport error
 *
 * "This plugin is switched off", "no such operation" and "the operation threw"
 * all come back as `ok: false` with a sentence. A plugin that is off has no
 * namespace registered, so it cannot answer, and the page shows that in place
 * instead of losing the socket. This is what isolates one plugin's fault to its
 * own page.
 */
import { errMessage } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/**
 * The one collaborator this family needs: the kernel's plugin-rpc registry.
 *
 * A thunk rather than the service itself because the controller is built before
 * the kernel exists (the assembly hands the kernel back afterwards), and reading
 * it per call is also what makes a re-roster visible — a switch flip replaces the
 * whole registry with the tree.
 */
export interface PluginFrameHost {
  invoke(plugin: string, op: string, payload: unknown): Promise<unknown>;
}

/**
 * Handle one `plugin_request`.
 * @param client - the connection to answer.
 * @param frame - the validated request.
 * @param host - the plugin-rpc registry.
 */
export async function handlePluginFrame(
  client: WsConnection,
  frame: Extract<ClientFrame, { type: 'plugin_request' }>,
  host: PluginFrameHost,
): Promise<void> {
  const base = { type: 'plugin_response' as const, id: frame.id, plugin: frame.plugin, op: frame.op };
  try {
    const result = await host.invoke(frame.plugin, frame.op, frame.payload);
    // `result` is omitted rather than sent as null when an operation answers
    // nothing: JSON has one empty value, and a page cannot tell "no answer" from
    // "the answer is literally null" if both arrive as null.
    client.send(serialize(result === undefined ? { ...base, ok: true } : { ...base, ok: true, result }));
  } catch (err) {
    client.send(serialize({ ...base, ok: false, error: errMessage(err) }));
  }
}
