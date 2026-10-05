import { describe, expect, it } from 'vitest';
import type { ServerFrame } from '../src/types.js';
import { MAX_COALESCED_FRAMES, StreamCoalescer, isStreamFrame, mergeStreamFrames, type CoalesceClock } from '../src/stream-coalesce.js';

/**
 * The socket-level delta batcher: chunk rate in, frame rate out. These pins are
 * about ORDER and BOUNDARIES — a merged run must be byte-identical (and
 * positionally identical) to the chunks it replaced, and nothing may ever
 * cross a kind or message boundary.
 */

const text = (messageId: string, body: string): ServerFrame => ({
  type: 'event',
  event: { type: 'text_delta', messageId, text: body },
});

const reasoning = (body: string): ServerFrame => ({
  type: 'event',
  event: { type: 'reasoning_delta', text: body },
});

const done: ServerFrame = { type: 'event', event: { type: 'done', stopReason: 'complete' } };

/** A clock the test drives by hand: no timers, deterministic boundaries. */
function manualClock(): CoalesceClock & { fire(): void; armed(): boolean } {
  let pending: (() => void) | null = null;
  return {
    schedule(run): void { pending = run; },
    cancel(): void { pending = null; },
    fire(): void { const run = pending; pending = null; run?.(); },
    armed: () => pending !== null,
  };
}

const merged = (frames: ServerFrame[]): string[] =>
  mergeStreamFrames(frames).map((frame) => {
    if (frame.type !== 'event') return 'other';
    if (frame.event.type === 'text_delta') return `t:${frame.event.text}`;
    if (frame.event.type === 'reasoning_delta') return `r:${frame.event.text}`;
    return 'other';
  });

describe('mergeStreamFrames', () => {
  it('merges adjacent same-kind same-message deltas into one frame', () => {
    expect(merged([text('m1', '你'), text('m1', '好'), text('m1', '吗')])).toEqual(['t:你好吗']);
    expect(merged([reasoning('a'), reasoning('b')])).toEqual(['r:ab']);
  });

  it('breaks the run on a kind change, preserving sequence', () => {
    expect(merged([text('m1', 'a'), reasoning('b'), text('m1', 'c')])).toEqual(['t:a', 'r:b', 't:c']);
  });

  it('breaks the run on a message change — two messages must never become one', () => {
    expect(merged([text('m1', 'a'), text('m2', 'b')])).toEqual(['t:a', 't:b']);
  });

  it('passes non-stream frames through untouched, in position', () => {
    expect(merged([text('m1', 'a'), done, text('m1', 'b')])).toEqual(['t:a', 'other', 't:b']);
  });

  it('classifies exactly the two delta kinds as stream frames', () => {
    expect(isStreamFrame(text('m', 'x'))).toBe(true);
    expect(isStreamFrame(reasoning('x'))).toBe(true);
    expect(isStreamFrame(done)).toBe(false);
    expect(isStreamFrame({ type: 'ready', info: {} as never })).toBe(false);
  });
});

describe('StreamCoalescer', () => {
  it('holds deltas until the frame fires, then emits one merged frame', () => {
    const clock = manualClock();
    const emitted: ServerFrame[][] = [];
    const coalescer = new StreamCoalescer((frames) => emitted.push([...frames]), clock);
    expect(coalescer.absorb(text('m1', 'a'))).toBe(true);
    expect(coalescer.absorb(text('m1', 'b'))).toBe(true);
    expect(emitted).toHaveLength(0); // nothing until the frame boundary
    expect(clock.armed()).toBe(true);
    clock.fire();
    expect(emitted).toHaveLength(1);
    expect(merged(emitted[0] ?? [])).toEqual(['t:ab']);
    expect(clock.armed()).toBe(false);
  });

  it('refuses non-stream frames so the caller can flush and handle them itself', () => {
    const clock = manualClock();
    const emitted: ServerFrame[][] = [];
    const coalescer = new StreamCoalescer((frames) => emitted.push([...frames]), clock);
    expect(coalescer.absorb(text('m1', 'a'))).toBe(true);
    expect(coalescer.absorb(done)).toBe(false);
    // The caller's contract: flushNow() BEFORE handling the non-stream frame.
    coalescer.flushNow();
    expect(merged(emitted[0] ?? [])).toEqual(['t:a']);
  });

  it('flushNow is idempotent and releases everything buffered', () => {
    const clock = manualClock();
    const emitted: ServerFrame[][] = [];
    const coalescer = new StreamCoalescer((frames) => emitted.push([...frames]), clock);
    coalescer.absorb(text('m1', 'a'));
    coalescer.flushNow();
    coalescer.flushNow();
    expect(emitted).toHaveLength(1);
  });

  it('re-arms for the next run after a flush', () => {
    const clock = manualClock();
    const emitted: ServerFrame[][] = [];
    const coalescer = new StreamCoalescer((frames) => emitted.push([...frames]), clock);
    coalescer.absorb(text('m1', 'a'));
    coalescer.flushNow();
    coalescer.absorb(text('m1', 'b'));
    expect(clock.armed()).toBe(true);
    clock.fire();
    expect(emitted.map((batch) => merged(batch))).toEqual([['t:a'], ['t:b']]);
  });

  it('dispose drops the schedule and the buffer', () => {
    const clock = manualClock();
    const emitted: ServerFrame[][] = [];
    const coalescer = new StreamCoalescer((frames) => emitted.push([...frames]), clock);
    coalescer.absorb(text('m1', 'a'));
    coalescer.dispose();
    expect(clock.armed()).toBe(false);
    clock.fire();
    expect(emitted).toHaveLength(0);
  });
});

describe('the buffer ceiling', () => {
  it('flushes synchronously once the buffer hits its ceiling (a hidden tab cannot grow it without bound)', () => {
    const clock = manualClock();
    const emitted: ServerFrame[][] = [];
    const coalescer = new StreamCoalescer((frames) => emitted.push([...frames]), clock);
    for (let index = 0; index < MAX_COALESCED_FRAMES; index += 1) {
      coalescer.absorb(text('m1', 'a'));
    }
    // Under the ceiling the batch is still pending: nothing emitted, clock armed.
    expect(emitted).toHaveLength(0);
    expect(clock.armed()).toBe(true);
    // One frame past the ceiling: the accumulated batch releases NOW, without
    // the clock, and the new frame opens a fresh batch (re-armed).
    coalescer.absorb(text('m1', 'b'));
    expect(emitted).toHaveLength(1);
    expect(clock.armed()).toBe(true);
    // The released run carried everything buffered up to the ceiling, merged.
    expect(merged(emitted[0] ?? [])).toEqual(['t:' + 'a'.repeat(MAX_COALESCED_FRAMES)]);
  });
});
