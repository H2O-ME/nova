/**
 * The connection's life cycle, with no React in it: dial the frame pipe,
 * survive drops with capped backoff, coalesce stream deltas at frame rate, and
 * hand every parsed frame to the caller. React binding lives in `../client.ts`
 * (the hook); this module is plain callbacks so the reconnection rules are
 * assertable without a DOM.
 *
 * A `ready` on each (re)open re-baselines the transcript from the durable log,
 * so a dropped run is never "lost" — the next open catches it up.
 *
 * The DIAL itself is a {@link Transport}: the browser entry is gone, and the
 * only shipped surface is the Tauri desktop window, whose pipe is
 * {@link tauriTransport} (Tauri IPC → the host's frame channel). Tests and
 * future surfaces inject their own transport factory; nothing here knows how
 * bytes actually travel.
 */
import { StreamCoalescer } from '../stream-coalesce.js';

/**
 * Report one transport failure where a developer can actually see it.
 *
 * Every path in this module used to swallow its reason (`.catch(() => undefined)`),
 * and the consequence was a window stuck on 「会话不可用」 with no evidence
 * anywhere: the runtime logged nothing, the shell logged nothing, and the UI
 * showed a placeholder. This channel has exactly one failure mode — the IPC
 * bridge is missing or the shell refused a command — so the reason is always
 * worth one line.
 * @param what - the step that failed.
 * @param err - what the bridge answered.
 */
function report(what: string, err?: unknown): void {
  const detail = err === undefined ? '' : `: ${err instanceof Error ? err.message : String(err)}`;
  console.error(`[nova-transport] ${what}${detail}`);
}

/** First reconnect delay: fast enough to feel automatic on a blip. */
export const RETRY_MIN_MS = 500;

/** Largest reconnect delay: a long outage keeps trying, twice a minute. */
export const RETRY_MAX_MS = 5000;

/**
 * The backoff schedule, as a pure function.
 *
 * A normal drop waits `retryMs` and then doubles, capped at
 * {@link RETRY_MAX_MS}; a MANUAL retry waits nothing and re-seeds the schedule
 * rather than inheriting the grown delay — otherwise a reader pressing 重试
 * against a long outage would be pushed further away by their own click.
 * @param previousMs - the delay used before this close.
 * @param immediate - the close was caused by a manual retry.
 * @returns the delay to wait, and the delay to use next time.
 */
export function nextRetry(previousMs: number, immediate: boolean): { delayMs: number; nextMs: number } {
  if (immediate) return { delayMs: 0, nextMs: RETRY_MIN_MS };
  return { delayMs: previousMs, nextMs: Math.min(previousMs * 2, RETRY_MAX_MS) };
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/**
 * One dial's byte pipe: the three abilities the life cycle actually needs —
 * put one line of JSON out, take lines of JSON in, and learn when the pipe
 * died. A transport instance is ONE attempt; a reconnect dials a fresh one
 * (see `createConnection`'s factory argument), so a transport never has to
 * model reconnection itself.
 */
export interface Transport {
  /**
   * Send one line of JSON. Returns false when the pipe cannot carry it yet —
   * the caller decides what "not sent" means.
   */
  send: (text: string) => boolean;
  /** Abandon this dial: release listeners, stop the attempt. Never re-used. */
  close: () => void;
  /** One inbound line of JSON, in the host's order. */
  onFrame: (cb: (text: string) => void) => void;
  /** The pipe is up and can carry frames (the socket's `open`). */
  onReady: (cb: () => void) => void;
  /** The pipe died (the socket's `close`); fires at most once per dial. */
  onClose: (cb: () => void) => void;
}

/** The Rust command the desktop shell serves outbound frames on. */
const NOVA_SEND_COMMAND = 'nova_send';
/** The event the desktop shell emits per inbound frame (`{ line }` payload). */
const NOVA_FRAME_EVENT = 'nova-frame';

/**
 * The slice of Tauri's injected bridge this transport uses — the same shapes
 * `shell/WindowControls.tsx` rides, kept local so the UI bundle never imports
 * `@tauri-apps/api` (a dependency this package does not have and must not
 * grow: the same bundle serves non-desktop surfaces).
 */
interface TauriInternals {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** Register a callback Rust can address by id (how `event|listen` delivers). */
  transformCallback: (callback: (event: unknown) => void, once?: boolean) => number;
}

function bridge(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { __TAURI_INTERNALS__?: Partial<TauriInternals> };
  const internals = host.__TAURI_INTERNALS__;
  // Both members this transport calls must exist: an internals object from a
  // different Tauri generation is as useless as no internals at all.
  if (typeof internals?.invoke !== 'function' || typeof internals?.transformCallback !== 'function') return null;
  return internals as TauriInternals;
}

/**
 * The desktop-shell transport: every outbound frame is one `nova_send` IPC
 * call, every inbound frame one `nova-frame` event.
 *
 * The bridge is installed by the webview's own init script, and the runtime
 * page is a REMOTE origin for the shell, so its init can land after this
 * module dials — the same race `WindowControls` solves by polling. A dial that
 * finds no bridge within that window (a plain browser: `pnpm dev` without the
 * shell) reports closed, and the connection's own backoff re-dials; there is
 * no other failure to distinguish, because there is no other way to reach the
 * host.
 *
 * A send that the shell refuses (the pipe command missing, the kernel gone)
 * fires `onClose` too: the pipe's death is the reconnect loop's business, not
 * the caller's.
 */
export function tauriTransport(): Transport {
  let frameCb: ((text: string) => void) | undefined;
  let readyCb: (() => void) | undefined;
  let closeCb: (() => void) | undefined;
  let ready = false;
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let handlerId: number | undefined;

  const stopPolling = (): void => {
    if (pollTimer !== undefined) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  };

  const fail = (reason: string, err?: unknown): void => {
    if (closed) return;
    report(reason, err);
    closed = true;
    ready = false;
    stopPolling();
    closeCb?.();
  };

  const unlisten = (internals: TauriInternals, id: number): void => {
    // Best effort: a dead shell has nothing left to unregister.
    void internals.invoke('plugin:event|unlisten', { event: NOVA_FRAME_EVENT, eventId: id }).catch(() => {});
  };

  const listen = (internals: TauriInternals): void => {
    const id = internals.transformCallback((event: unknown) => {
      if (closed) return;
      // The shell forwards one wire line per event: `{ line: string }`.
      const line = (event as { payload?: { line?: unknown } } | undefined)?.payload?.line;
      if (typeof line === 'string') frameCb?.(line);
    });
    handlerId = id;
    void internals
      .invoke('plugin:event|listen', { event: NOVA_FRAME_EVENT, target: { kind: 'Any' }, handler: id })
      .then(() => {
        if (closed) {
          unlisten(internals, id);
          return;
        }
        ready = true;
        // Tell the shell the listener exists so it flushes what it buffered.
        // The runtime writes `ready` the instant it attaches — long before this
        // module has a webview to listen with — so the shell holds those early
        // frames in a startup bridge instead of emitting them into the void.
        // Without this call the bridge never drains and the window stays
        // un-baselined (no transcript, no model) until the operator reloads.
        void internals.invoke('nova_ready', {}).catch((err: unknown) => report('nova_ready refused', err));
        readyCb?.();
      })
      .catch((err: unknown) => fail('event|listen refused', err));
  };

  // Poll for the bridge the way `WindowControls` does: briefly, and adopt it
  // when it shows up. In a browser it never does, and the dial fails — which
  // is what arms the connection's backoff instead of hanging in `connecting`.
  let tries = 0;
  const poll = (): void => {
    const internals = bridge();
    if (internals !== null) {
      listen(internals);
      return;
    }
    tries += 1;
    if (tries >= 24) {
      fail(`no IPC bridge after ${tries} polls (24×250ms) — not running inside the shell?`);
      return;
    }
    pollTimer = setTimeout(poll, 250);
  };
  poll();

  return {
    send: (text) => {
      if (closed || !ready) return false;
      const internals = bridge();
      if (internals === null) {
        fail('bridge vanished mid-session');
        return false;
      }
      // Fire-and-forget: the wire has no per-frame acknowledgement. A refusal
      // means the pipe itself is gone, and that is a close, not a send result.
      void internals.invoke(NOVA_SEND_COMMAND, { frame: text }).catch((err: unknown) => fail('nova_send refused', err));
      return true;
    },
    close: () => {
      // Same close path as `fail`: one shutdown, one notification. Without the
      // callback a manual reconnect would kill this dial and never learn it
      // (`onClose` is what re-arms the schedule), leaving the UI disconnected
      // until a reload.
      if (closed) return;
      closed = true;
      ready = false;
      stopPolling();
      const internals = bridge();
      if (internals !== null && handlerId !== undefined) unlisten(internals, handlerId);
      closeCb?.();
    },
    onFrame: (cb) => {
      frameCb = cb;
    },
    onReady: (cb) => {
      readyCb = cb;
    },
    onClose: (cb) => {
      closeCb = cb;
    },
  };
}

export interface ConnectionEvents {
  /** A parsed (and coalesced) inbound frame, in the host's order. */
  onFrame: (frame: unknown) => void;
  /** The dialing status changed. */
  onStatus: (status: ConnectionStatus) => void;
}

export interface Connection {
  /**
   * Send one client frame. Returns false when the pipe is not ready — the
   * caller decides what "not sent" means (the reducer's `sent` bookkeeping
   * fires only for frames that actually left).
   */
  send: (frame: unknown) => boolean;
  /**
   * Drop the current pipe and dial again at once, skipping the backoff.
   *
   * The backoff is capped at 5s, so without this the indicator's retry is only
   * a promise: a reader watching a dead pipe waits up to five seconds with no
   * way to hurry it. Reconnecting instead of merely re-dialling matters when
   * the pipe is still up but the peer is a zombie — `close()` runs the same
   * close path that re-arms the schedule, so there is exactly one reconnect
   * path.
   */
  reconnect: () => void;
  /** Stop for good: no more dials, listeners released. */
  dispose: () => void;
}

/**
 * @param events - the frame and status sinks.
 * @param dial - how one attempt is made; defaults to the desktop shell's pipe.
 *   A factory, not an instance: every reconnect is a fresh transport, so a
 *   transport never outlives the attempt it was created for.
 */
export function createConnection(events: ConnectionEvents, dial: () => Transport = tauriTransport): Connection {
  let closedByUs = false;
  let retryMs = RETRY_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let transport: Transport | undefined;
  /**
   * One dial's identity. A transport's callbacks are ignored once a newer dial
   * exists: a manual reconnect closes the old transport synchronously and then
   * dials, and a late event from the closed one must not schedule a second dial
   * on top of the new one.
   */
  let generation = 0;

  const open = (): void => {
    const gen = ++generation;
    events.onStatus('connecting');
    const current = dial();
    transport = current;
    // Stream deltas render at FRAME rate, not chunk rate (stream-coalesce.ts):
    // the buffer releases at most once per painted frame, and any other frame
    // flushes it first so the reducer still sees the kernel's exact order.
    const coalescer = new StreamCoalescer((frames) => {
      if (gen !== generation) return;
      for (const flushed of frames) events.onFrame(flushed);
    });
    current.onFrame((text) => {
      if (gen !== generation) return;
      let frame: unknown;
      try {
        frame = JSON.parse(text) as unknown;
      } catch {
        return; // foreign bytes on the pipe: ignore, never eval
      }
      if (!coalescer.absorb(frame as never)) {
        coalescer.flushNow();
        events.onFrame(frame);
      }
    });
    current.onReady(() => {
      if (gen !== generation) return;
      retryMs = RETRY_MIN_MS;
      events.onStatus('open');
      // NO state change beyond the status here. The pipe being open is not the
      // session being serviceable: until the host's `ready` lands, `meta` is
      // null and a prompt sent now is answered by nobody. `connected` is lit
      // by the `ready` reduction alone — the one fact every control gates on.
    });
    current.onClose(() => {
      if (gen !== generation) return;
      // The tail the buffer still holds belongs to the transcript that just
      // ended: land it before the disconnect state reads "the run is over".
      coalescer.flushNow();
      events.onStatus('closed');
      if (closedByUs) return;
      if (timer !== undefined) clearTimeout(timer);
      const step = nextRetry(retryMs, false);
      timer = setTimeout(open, step.delayMs);
      retryMs = step.nextMs;
    });
  };

  open();

  return {
    send: (frame) => {
      const current = transport;
      if (current === undefined) return false;
      return current.send(JSON.stringify(frame));
    },
    reconnect: () => {
      if (closedByUs) return;
      // Drop the pending backoff, close the current dial (which flushes the
      // buffered tail through the same close path), then dial at once. A retry
      // that only set a flag used to wait out the remaining backoff — or, when
      // the dial was still polling for the bridge, kill it and never re-dial.
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      retryMs = RETRY_MIN_MS;
      transport?.close();
      // `close()` may have scheduled a retry through `onClose`; this dial
      // supersedes it (the generation guard also ignores its callbacks).
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      open();
    },
    dispose: () => {
      closedByUs = true;
      if (timer !== undefined) clearTimeout(timer);
      transport?.close();
    },
  };
}
