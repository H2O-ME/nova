/**
 * `@nova-agent/web` — the WebUI surface (M11 批2). Public entry: `launchWeb`
 * assembles controller + auth + server and returns the loopback launch URL; the
 * pieces are exported individually for tests and a future `--web` hosting.
 */
import { contextInsights as contextInsightsKey } from '@nova-agent/core';
import { loadLaunchAuth } from './auth-store.js';
import { WebController } from './controller.js';
import { startWebServer, type WebServerHandle } from './server.js';
import type { LaunchWebOptions } from './options.js';

export { WebController } from './controller.js';
export { WebRouteRegistry } from './route-registry.js';
export { startWebServer, type WebServerHandle, type StartWebServerOptions } from './server.js';
export { createLaunchAuth, cookieHeader, cookieValue, verifyCookie, AUTH_COOKIE, type LaunchAuth } from './auth.js';
export { loadLaunchAuth } from './auth-store.js';
export { readPreferredPort, writePreferredPort } from './port.js';
export { serializeServerFrame, MAX_CLIENT_FRAME_BYTES, MAX_MODEL_CHARS, MAX_PROMPT_CHARS, MAX_TERM_INPUT_CHARS, MAX_TEXT_FIELD_CHARS, type ApprovalMode, type ClientFrame, type ServerFrame, type ReadyInfo, type SessionListItem, type WireBlock, type WireTraceRow, type WireSkillEntry } from './protocol.js';
export { parseClientFrame } from './client-frame.js';
export { reject, type FrameRejection } from './reject.js';
export { projectTranscript } from './transcript.js';
export { upgrade, WS_MAX_MESSAGE_BYTES, WS_MAX_BUFFERED_BYTES, type WsConnection, type WsHandlers } from './ws.js';
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
  const { staticDir, port, host: _host, onReady, routes, ...controllerOptions } = opts;
  const controller = await WebController.create(controllerOptions);
  // The pairing (cookieToken + secret) persists under ~/.nova/cache so the
  // cookie — not the URL token, which stays per-boot — outlives the process.
  const auth = await loadLaunchAuth();
  const handle = await startWebServer({
    controller,
    auth,
    staticDir,
    host,
    ...(port !== undefined ? { port } : {}),
    ...(routes !== undefined ? { routes } : {}),
    // The read-only Browser/DNA route reaches the fold through the SAME service
    // key the live path uses, instead of statically importing the producer: the
    // context plugin is an optional extension and this surface has to run
    // without it. Resolved per request — the container mutates in place when the
    // plugin is switched on, so a boot-time read would pin the answer.
    contextWindow: () => opts.kernel.host.context.get(contextInsightsKey),
  });
  onReady?.(handle.url);
  return handle;
}
