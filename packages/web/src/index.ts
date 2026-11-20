/**
 * `@nova-agent/web` — the desktop surface's runtime half.
 *
 * Public entry: `launchDesktop` assembles the controller and serves it over the
 * shell's stdio pipe. The pieces are exported individually for tests and for a
 * second shell that speaks the same frame protocol over a different channel.
 *
 * What this package is NOT, since the browser entry was cut: an HTTP server, a
 * WebSocket endpoint, an auth gate, a static-file host, or a port owner. A Tauri
 * window loads the built UI from disk and talks to this process over its own
 * pipes, so those five concerns have no address to live at — which is why the
 * files that held them were deleted rather than ported.
 */
export { WebController } from './controller.js';
export { WebRouteRegistry } from './route-registry.js';
export { launchDesktop, type DesktopHostHandle, type DesktopHostIO, type DesktopHostOptions } from './desktop-host.js';
export { pipeConnection, lineSplitter, parsePipeLine, MAX_PIPE_LINE_BYTES, type PipeHandlers, type PipeWriter } from './pipe.js';
export type { WsConnection, WsHandlers } from './connection.js';
export { serializeServerFrame, MAX_CLIENT_FRAME_BYTES, MAX_IMAGE_FRAME_BYTES, MAX_MODEL_CHARS, MAX_PROMPT_CHARS, MAX_TERM_INPUT_CHARS, MAX_TEXT_FIELD_CHARS, type ApprovalMode, type ClientFrame, type ServerFrame, type ReadyInfo, type SessionListItem, type WireBlock, type WireTraceRow, type WireSkillEntry } from './protocol.js';
export { parseClientFrame } from './client-frame.js';
export { reject, type FrameRejection } from './reject.js';
export { projectTranscript } from './transcript.js';
export type { ControllerOptions } from './options.js';
