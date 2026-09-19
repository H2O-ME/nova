/**
 * `@nova-agent/web` — the WebUI surface (M11 批2). Public entry: `launchWeb`
 * assembles controller + auth + server and returns the loopback launch URL;
 * the pieces are also exported individually for tests and for a future
 * `--web` mode wiring with different hosting.
 */
import { createLaunchAuth } from './auth.js';
import { WebController } from './controller.js';
import { startWebServer, type WebServerHandle } from './server.js';
import type { LaunchWebOptions } from './options.js';

export { WebController } from './controller.js';
export { startWebServer, type WebServerHandle, type StartWebServerOptions } from './server.js';
export { createLaunchAuth, cookieHeader, cookieValue, verifyCookie, AUTH_COOKIE, type LaunchAuth } from './auth.js';
export { parseClientFrame, serializeServerFrame, toAskResult, MAX_CLIENT_FRAME_BYTES, MAX_PROMPT_CHARS, type ApprovalMode, type ClientFrame, type PtcMode, type ServerFrame, type ReadyInfo, type SessionListItem, type WireAnswer, type WireBlock } from './protocol.js';
export { projectTranscript } from './transcript.js';
export { upgrade, acceptKey, encodeTextFrame, WS_MAX_MESSAGE_BYTES, type WsConnection, type WsHandlers } from './ws.js';
export type { LaunchWebOptions, ControllerOptions } from './options.js';

/** One call: controller + auth + server on a loopback port → launch URL. */
export async function launchWeb(opts: LaunchWebOptions): Promise<WebServerHandle> {
  const host = opts.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('web surface is localhost-only (loopback bind required)');
  }
  const controller = await WebController.create({
    rootDir: opts.rootDir,
    provider: opts.provider,
    config: opts.config,
    providerModelLabel: opts.providerModelLabel,
    ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    ...(opts.bindSessionAffinity !== undefined ? { bindSessionAffinity: opts.bindSessionAffinity } : {}),
    ...(opts.contextWindow !== undefined ? { contextWindow: opts.contextWindow } : {}),
  });
  const auth = createLaunchAuth();
  const handle = await startWebServer({
    controller,
    auth,
    staticDir: opts.staticDir,
    host,
    ...(opts.port !== undefined ? { port: opts.port } : {}),
  });
  opts.onReady?.(handle.url);
  return handle;
}
