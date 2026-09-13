import { describe, expect, it } from 'vitest';
import { StreamSmoother } from '../src/smooth.js';

describe('StreamSmoother', () => {
  it('meters a burst out over several ticks instead of dumping it', () => {
    const s = new StreamSmoother();
    s.push('a'.repeat(80));
    const first = s.take(2, 8);
    expect(first.length).toBe(10); // ceil(80/8), above the floor
    expect(s.length).toBe(70);
    // Steady drain: each tick takes another ~backlog/8.
    let revealed = first.length;
    for (let i = 0; i < 20 && s.length > 0; i++) revealed += s.take(2, 8).length;
    expect(s.length).toBe(0);
    expect(revealed).toBe(80);
  });

  it('keeps a typing floor so a slow trickle still animates', () => {
    const s = new StreamSmoother();
    s.push('abc');
    expect(s.take(2, 8)).toBe('ab');
    expect(s.take(2, 8)).toBe('c');
  });

  it('drains everything once the backlog fits one take', () => {
    const s = new StreamSmoother();
    s.push('你好世界');
    const out = s.take(2, 8) + s.take(2, 8) + s.take(2, 8);
    expect(out).toBe('你好世界');
    expect(s.length).toBe(0);
    expect(s.take(2, 8)).toBe('');
  });

  it('never splits a surrogate pair at the take boundary', () => {
    const s = new StreamSmoother();
    // 'a' + 😀 (surrogate pair) + 'b': a take of 2 would land mid-pair, so it
    // backs off to 'a' and the pair goes out whole on the next take.
    s.push('a\u{1F600}b');
    expect(s.take(2, 8)).toBe('a');
    expect(s.take(2, 8)).toBe('\u{1F600}');
    expect(s.take(2, 8)).toBe('b');
  });

  it('flush() reveals everything and clear() drops it', () => {
    const f = new StreamSmoother();
    f.push('tail text');
    expect(f.flush()).toBe('tail text');
    expect(f.length).toBe(0);

    const c = new StreamSmoother();
    c.push('dropped');
    c.clear();
    expect(c.length).toBe(0);
    expect(c.flush()).toBe('');
  });
});
