import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { LineSource } from '../src/repl.js';

describe('LineSource', () => {
  // The real createInterface type is structural here: on('line'|'close'),
  // setPrompt, prompt — all an EventEmitter with those methods satisfies.
  function makeRl(): { bus: EventEmitter; rl: object } {
    const bus = new EventEmitter();
    const rl = {
      on: (event: string, listener: (...args: never[]) => void) => bus.on(event, listener),
      setPrompt: () => {},
      prompt: () => {},
    };
    return { bus, rl };
  }

  it('delivers queued lines one at a time', async () => {
    const { bus, rl } = makeRl();
    const source = new LineSource(rl as never, false);
    bus.emit('line', 'first');
    bus.emit('line', 'second');
    expect(await source.next('> ')).toBe('first');
    expect(await source.next('> ')).toBe('second');
  });

  it('cancelPending resolves the pending next() with null without closing the stream', async () => {
    const { bus, rl } = makeRl();
    const source = new LineSource(rl as never, false);
    const pending = source.next('> ');
    // Let the promise reach its waiting state, then interrupt.
    await new Promise((resolve) => setImmediate(resolve));
    source.cancelPending();
    expect(await pending).toBeNull();
    // The stream survives the cancel: a later line still comes through.
    bus.emit('line', 'after interrupt');
    expect(await source.next('> ')).toBe('after interrupt');
  });

  it('close resolves a pending next() with null', async () => {
    const { bus, rl } = makeRl();
    const source = new LineSource(rl as never, false);
    const pending = source.next('> ');
    await new Promise((resolve) => setImmediate(resolve));
    bus.emit('close');
    expect(await pending).toBeNull();
    // After close, next() short-circuits to null (EOF semantics).
    expect(await source.next('> ')).toBeNull();
  });

  it('a line arriving after cancelPending still queues (no lost input)', async () => {
    const { bus, rl } = makeRl();
    const source = new LineSource(rl as never, false);
    const pending = source.next('> ');
    await new Promise((resolve) => setImmediate(resolve));
    source.cancelPending();
    bus.emit('line', 'typed during cancel window');
    expect(await pending).toBeNull();
    expect(await source.next('> ')).toBe('typed during cancel window');
  });
});
