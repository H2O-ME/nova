/**
 * `@nova-agent/web` — the WebUI surface (M11 批2). Public entry: `launchWeb`
 * assembles controller + auth + server and returns the loopback launch URL; the
 * pieces are exported individually for tests and a future `--web` hosting.
 */
import { createLaunchAuth } from './auth.js';
import { WebController } from './controller.js';
import { startWebServer, type WebServerHandle } from './server.js';
import type { LaunchWebOptions } from './options.js';

export { WebController } from './controller.js';
export { startWebServer, type WebServerHandle, type StartWebServerOptions } from './server.js';
export { createLaunchAuth, cookieHeader, cookieValue, verifyCookie, AUTH_COOKIE, type LaunchAuth } from './auth.js';
export { serializeServerFrame, MAX_CLIENT_FRAME_BYTES, MAX_MODEL_CHARS, MAX_PROMPT_CHARS, MAX_TERMINAL_COMMAND_CHARS, MAX_TEXT_FIELD_CHARS, type ApprovalMode, type ClientFrame, type PtcMode, type ServerFrame, type ReadyInfo, type SessionListItem, type WireBlock, type WireTraceRow, type WireSkillEntry } from './protocol.js';
export { parseClientFrame } from './client-frame.js';
export { reject, type FrameRejection } from './reject.js';
export { projectTranscript } from './transcript.js';
export { upgrade, acceptKey, encodeTextFrame, WS_MAX_MESSAGE_BYTES, type WsConnection, type WsHandlers } from './ws.js';
export type { LaunchWebOptions, ControllerOptions } from './options.js';

/** One call: controller + auth + server on a loopback port → launch URL. */
export async function launchWeb(opts: LaunchWebOptions): Promise<WebServerHandle> {
  const host = opts.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('web surface is localhost-only (loopback bind required)');
  }
  // Everything that is not a hosting concern belongs to the controller, so it
  // is forwarded wholesale instead of field by field: hand-copying silently
  // dropped newly added options (a missed optional field still typechecks).
  const { staticDir, port, host: _host, onReady, ...controllerOptions } = opts;
  const controller = await WebController.create(controllerOptions);
  const auth = createLaunchAuth();
  const handle = await startWebServer({
    controller,
    auth,
    staticDir,
    host,
    ...(port !== undefined ? { port } : {}),
  });
  onReady?.(handle.url);
  return handle;
}
