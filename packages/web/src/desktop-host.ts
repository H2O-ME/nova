/**
 * The desktop host: the ONLY place a controller is wired to a transport now.
 *
 * It replaces `launchWeb()` (`index.ts`) and `startWebServer()` (`server.ts`).
 * What those two did between them — pick a port, persist a preferred one, sign a
 * cookie, serve the built bundle, validate a launch token, own the WS upgrade —
 * existed to answer one question a desktop shell never asks: "how does a browser
 * on this machine, which shares no memory with this process, reach it?" A Tauri
 * window does not reach it. It IS the parent process, and the child's stdio is a
 * channel nobody else can open.
 *
 * So this file is deliberately small: create the controller, attach ONE
 * pipe-backed connection, pump validated frames from stdin, and dispose on EOF.
 * There is no port, no origin, no token and no cookie — which is also why every
 * one of those files could be deleted rather than ported.
 *
 * ## The stdout rule
 *
 * `stdout` carries frames, one JSON object per line, and nothing else. Every
 * other diagnostic in this process — including the shell's own boot messages —
 * goes to `stderr` (see `surface-desktop.ts`). A stray `console.log` here would
 * be read by the shell as a frame it cannot parse, so the rule is enforced where
 * the stream is taken over, not by discipline alone.
 */
import type { Readable, Writable } from 'node:stream';
import { WebController } from './controller.js';
import { lineSplitter, pipeConnection, parsePipeLine } from './pipe.js';
import type { WsConnection } from './connection.js';
import type { ControllerOptions } from './controller-options.js';

/**
 * Where the host's stdin and stdout come from. Injected so a test can drive the
 * whole loop over two `PassThrough` streams instead of the real process pipes —
 * and so the production defaults are stated in exactly one place.
 */
export interface DesktopHostIO {
  /** Frames arrive here, one JSON object per line. */
  input: Readable;
  /** Frames leave here, one JSON object per line. */
  output: Writable;
}

export interface DesktopHostOptions extends ControllerOptions {
  /** Defaults to `process.stdin` / `process.stdout`. */
  io?: DesktopHostIO;
  /**
   * Called once the connection is attached and the first `ready` has been
   * written. The surface uses it to log "ready" to stderr — the shell shows the
   * window on the first frame, so nothing else has to signal readiness.
   */
  onReady?: () => void;
}

/** The handle a surface holds: one way to stop, and the controller it owns. */
export interface DesktopHostHandle {
  controller: WebController;
  /**
   * Resolves once the loop has stopped and everything is torn down — the shell's
   * EOF and a programmatic `close()` both land here.
   *
   * This is not a convenience: a surface's `start()` has to AWAIT the end, and
   * the previous shape (`await new Promise<never>(() => undefined)`) left that
   * await permanently unsettled once the pipe closed. Node answers an unsettled
   * top-level await with exit code 13, so a window closing normally reported a
   * crash. The signal is therefore the surface's whole lifetime, not a detail.
   */
  readonly done: Promise<void>;
  /**
   * Stop the loop and tear everything down: the controller disposes the kernel,
   * every live session handle, the terminals and the jobs registry.
   */
  close(): Promise<void>;
}

/**
 * Assemble the controller and serve it over one stdio pipe.
 * @param opts - the controller's own options, plus the streams to use.
 * @returns the handle; `close()` is the single teardown.
 */
export async function launchDesktop(opts: DesktopHostOptions): Promise<DesktopHostHandle> {
  const { io, onReady, ...controllerOptions } = opts;
  const controller = await WebController.create(controllerOptions);
  const input = io?.input ?? process.stdin;
  const output = io?.output ?? process.stdout;

  // ONE connection for the process's whole life: the shell is the only client,
  // and a window reload does not drop the pipe (it reloads the document, not
  // the process). `ready` is therefore sent once, here, as the baseline.
  const connection: WsConnection = pipeConnection(output);
  controller.attach(connection);

  // The pipe's OWN line splitter rather than `readline`: the ceiling per line is
  // the one rule that matters on this channel (an image upload is 16 MiB, and a
  // writer that never sends a newline must not grow the buffer without bound),
  // and `readline` has no such ceiling. It is also the same code the pipe tests
  // drive, so the framing rules are the tested ones.
  let stopped = false;
  // Settled exactly once, by whichever path ends the process: stdin EOF, a read
  // error, or `close()`. The surface awaits this (see `DesktopHostHandle.done`).
  let settle: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    // The controller owns the kernel and every handle under it; disposing IS the
    // teardown (see `WebController.dispose`), so this is the one call.
    await controller.dispose().catch(() => undefined);
    settle();
  };

  const lines = lineSplitter({
    onMessage: (line: string) => {
      const frame = parsePipeLine(line, connection);
      if (frame === undefined) return;
      void controller.handle(connection, frame);
    },
    // EOF is the shell's shutdown signal: it closes our stdin instead of making
    // an HTTP request, so "stop gracefully" and "the writer went away" are one
    // event.
    onClose: () => {
      void stop();
    },
  });

  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    lines.push(chunk);
  });
  input.on('end', () => {
    lines.end();
  });
  // A read error on the pipe (the shell was killed) converges the same way.
  input.on('error', () => {
    void stop();
  });

  onReady?.();
  return { controller, done, close: stop };
}
