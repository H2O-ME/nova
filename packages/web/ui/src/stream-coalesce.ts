/**
 * The socket delivers one kernel event per provider chunk, and a streaming
 * provider emits many chunks per second. Rendering once per chunk re-renders
 * the whole surface at the chunk rate — the transcript janks exactly when the
 * reader is watching it (the reported 「流式卡顿」). The fix is at the socket's
 * own entry: deltas accumulate here and are released AT MOST once per frame,
 * so the render cadence is bounded while the visible text still advances every
 * frame the reader actually sees.
 *
 * Order is the invariant that makes this safe. Deltas may only be merged with
 * ADJACENT same-kind same-message deltas; any other frame (a tool start, the
 * closing `done`) flushes the buffer FIRST, so the reducer sees exactly the
 * sequence the kernel published — a merged run is byte-identical to the chunks
 * it replaced (string concatenation is associative), just delivered coarser.
 *
 * The clock is injectable so tests can drive flush boundaries without real
 * timers; the browser default is rAF, which also stops renders entirely while
 * the tab is hidden (the accumulated reply flushes once on return — the run's
 * text lives in the durable log either way).
 */
import type { ServerFrame } from './types.js';
import type { KernelEvent } from './types.js';

/** A delta frame this surface coalesces (`event` wrapping a text/reasoning delta). */
type StreamFrame = Extract<ServerFrame, { type: 'event' }> & {
  event: Extract<KernelEvent, { type: 'text_delta' } | { type: 'reasoning_delta' }>;
};

/** Is this frame a stream delta? Anything else must flush the buffer first. */
export function isStreamFrame(frame: ServerFrame): frame is StreamFrame {
  if (frame.type !== 'event') return false;
  return frame.event.type === 'text_delta' || frame.event.type === 'reasoning_delta';
}

/**
 * Merge runs of ADJACENT same-kind deltas into single frames. A kind change
 * breaks the run (the reducer streams into the block that is open; crossing a
 * boundary here would splice two messages together), and a `text_delta` run
 * also breaks on a messageId change — two messages must never become one.
 * `reasoning_delta` carries no message id (core's own shape: reasoning is
 * observability-only, never persisted), so its runs break on kind alone.
 * @param frames - buffered frames in arrival order.
 * @returns the same sequence, coarser-grained.
 */
export function mergeStreamFrames(frames: readonly ServerFrame[]): ServerFrame[] {
  const out: ServerFrame[] = [];
  for (const frame of frames) {
    const previous = out[out.length - 1];
    if (
      previous !== undefined
      && isStreamFrame(previous) && isStreamFrame(frame)
      && previous.event.type === frame.event.type
      && sameMessage(previous.event, frame.event)
    ) {
      out[out.length - 1] = {
        ...previous,
        event: { ...previous.event, text: previous.event.text + frame.event.text },
      };
      continue;
    }
    out.push(frame);
  }
  return out;
}

/** May two deltas of the SAME kind merge? Only text deltas carry a message id. */
function sameMessage(a: StreamFrame['event'], b: StreamFrame['event']): boolean {
  if (a.type === 'text_delta' && b.type === 'text_delta') return a.messageId === b.messageId;
  return true;
}

/**
 * The buffer's ceiling, in frames. A hidden tab never paints, so its rAF-based
 * clock never fires and the buffer would grow for the WHOLE run (hundreds of
 * thousands of chunks on a long reply) — the coalescer's memory would then be
 * set by the provider's chunk rate times the run's length, with no bound of
 * ours. Past the ceiling the buffer flushes synchronously: batching degrades
 * to per-chunk renders for the tail of that run, which is exactly what the
 * reader can't see anyway, and the bound is restored on the next paint.
 */
export const MAX_COALESCED_FRAMES = 500;

/** The flush scheduler, injected so tests drive boundaries without timers. */
export interface CoalesceClock {
  schedule(run: () => void): void;
  cancel(): void;
}

/** The browser clock: once per painted frame. */
export function frameClock(): CoalesceClock {
  let handle: number | undefined;
  const hasRaf = typeof requestAnimationFrame === 'function';
  return {
    schedule(run): void {
      handle = hasRaf ? requestAnimationFrame(run) : (setTimeout(run, 32) as unknown as number);
    },
    cancel(): void {
      if (handle === undefined) return;
      if (hasRaf) cancelAnimationFrame(handle);
      else clearTimeout(handle);
      handle = undefined;
    },
  };
}

/**
 * The buffer between the socket and the reducer. `absorb` returns false for
 * anything that is not a delta — the caller must then {@link flushNow} BEFORE
 * handling that frame, so a tool start can never overtake the text that
 * preceded it.
 */
export class StreamCoalescer {
  private buffer: ServerFrame[] = [];
  private scheduled = false;

  constructor(
    /** Receives each flushed run (in order). */
    private readonly emit: (frames: readonly ServerFrame[]) => void,
    private readonly clock: CoalesceClock = frameClock(),
  ) {}

  /** Buffer one frame. False = not a delta: the caller handles it itself. */
  absorb(frame: ServerFrame): boolean {
    if (!isStreamFrame(frame)) return false;
    // A frame would exceed the ceiling (a hidden tab's clock is not ticking):
    // release the accumulated batch NOW and let this frame start a fresh one.
    if (this.buffer.length >= MAX_COALESCED_FRAMES) this.flushNow();
    this.buffer.push(frame);
    if (!this.scheduled) {
      this.scheduled = true;
      this.clock.schedule(() => this.flushNow());
    }
    return true;
  }

  /** Release everything accumulated so far, in order, merged. Idempotent. */
  flushNow(): void {
    this.clock.cancel();
    this.scheduled = false;
    if (this.buffer.length === 0) return;
    const frames = mergeStreamFrames(this.buffer);
    this.buffer = [];
    this.emit(frames);
  }

  /** Drop the schedule (socket teardown). Anything still buffered is lost —
   *  the caller flushes before disposing if it wants the tail. */
  dispose(): void {
    this.clock.cancel();
    this.scheduled = false;
    this.buffer = [];
  }
}
