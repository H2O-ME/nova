import { plainPalette } from '@nova-agent/tui-view';
import { describe, expect, it } from 'vitest';
import { CompactWait } from '../src/tui/compact-wait.js';
import { TuiStore } from '../src/tui/store.js';

function setup() {
  const store = new TuiStore(() => undefined);
  let now = 1_000;
  let tick: (() => void) | undefined;
  let renderCount = 0;
  const wait = new CompactWait({
    store,
    paint: () => plainPalette,
    now: () => now,
    render: () => {
      renderCount += 1;
    },
    every: (fn) => {
      tick = fn;
      return () => {
        tick = undefined;
      };
    },
  });
  return { store, wait, advance: (ms: number) => (now += ms), tick: () => tick?.(), renderCount: () => renderCount };
}

describe('CompactWait', () => {
  it('start pushes the ticking wait line and rewrites it in place', () => {
    const t = setup();
    t.wait.start('正在压缩会话');
    expect(t.store.blocks).toHaveLength(1);
    const block = t.store.blocks[0]!;
    expect(block.lines[0]).toContain('正在压缩会话');
    t.advance(3_000);
    t.tick();
    expect(t.store.blocks).toHaveLength(1);
    expect(t.store.blocks[0]).toBe(block);
    expect(t.store.blocks[0]!.lines[0]).toContain('3s');
    expect(t.renderCount()).toBeGreaterThan(0);
  });

  it('elapsedSecs floors at 1s so a fast compaction never shows 0s', () => {
    const t = setup();
    t.wait.start('x');
    expect(t.wait.elapsedSecs()).toBe(1);
    t.advance(2_400);
    expect(t.wait.elapsedSecs()).toBe(2);
  });

  it('end stops the ticker (later ticks are no-ops)', () => {
    const t = setup();
    t.wait.start('x');
    t.wait.end();
    expect(t.tick()).toBeUndefined();
    expect(t.store.blocks).toHaveLength(1);
  });

  it('beginRequest/cancel abort the in-flight summarizer and mark it cancelled', () => {
    const t = setup();
    const aborter = t.wait.beginRequest();
    expect(aborter.signal.aborted).toBe(false);
    expect(t.wait.wasCancelled()).toBe(false);
    t.wait.cancel();
    expect(aborter.signal.aborted).toBe(true);
    expect(t.wait.wasCancelled()).toBe(true);
    t.wait.endRequest();
  });

  it('a new request resets the cancelled latch; exit aborts without marking it cancelled', () => {
    const t = setup();
    const first = t.wait.beginRequest();
    t.wait.cancel();
    expect(t.wait.wasCancelled()).toBe(true);
    const second = t.wait.beginRequest();
    expect(t.wait.wasCancelled()).toBe(false);
    t.wait.abortActive();
    expect(second.signal.aborted).toBe(true);
    expect(t.wait.wasCancelled()).toBe(false);
    expect(first.signal.aborted).toBe(true);
  });

  it('doneLine reports summary length, retained messages and elapsed seconds', () => {
    const t = setup();
    t.wait.start('x');
    t.advance(4_000);
    const line = t.wait.doneLine({ summary: 'z'.repeat(120), retained: 5 } as never);
    expect(line).toContain('已压缩');
    expect(line).toContain('120 字');
    expect(line).toContain('保留 5 条');
    expect(line).toContain('4s');
  });
});
