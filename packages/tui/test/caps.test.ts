import { describe, expect, it } from 'vitest';
import { detectCaps, LineScreen } from '../src/index.js';

describe('detectCaps', () => {
  it('NO_COLOR forces plain regardless of TTY', () => {
    const caps = detectCaps({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true);
    expect(caps.color).toBe(false);
    expect(caps.truecolor).toBe(false);
  });

  it('non-TTY output never gets color or sync output', () => {
    const caps = detectCaps({ TERM: 'xterm-256color' }, false);
    expect(caps).toEqual({ color: false, truecolor: false, synchronizedOutput: false });
  });

  it('TERM=dumb is treated as colorless', () => {
    expect(detectCaps({ TERM: 'dumb' }, true).color).toBe(false);
  });

  it('COLORTERM=truecolor upgrades to 24-bit on a TTY', () => {
    const caps = detectCaps({ COLORTERM: 'truecolor', TERM: 'xterm' }, true);
    expect(caps).toEqual({ color: true, truecolor: true, synchronizedOutput: true });
  });

  it('plain TTY without COLORTERM stays 16-color', () => {
    const caps = detectCaps({ TERM: 'xterm' }, true);
    expect(caps.color).toBe(true);
    expect(caps.truecolor).toBe(false);
    expect(caps.synchronizedOutput).toBe(true);
  });
});

describe('LineScreen synchronized output', () => {
  function fakeOut(): { out: NodeJS.WriteStream & { write(s: string): unknown }; writes: string[] } {
    const writes: string[] = [];
    const out = { write: (s: string) => writes.push(s) } as never;
    return { out, writes };
  }

  it('is opt-in: default renders without the 2026 pair', () => {
    const { out, writes } = fakeOut();
    const screen = new LineScreen(out);
    screen.enter();
    screen.render(['a']);
    expect(writes.some((w) => w.includes('?2026h'))).toBe(false);
  });

  it('wraps a changed frame between ?2026h and ?2026l when enabled', () => {
    const { out, writes } = fakeOut();
    const screen = new LineScreen(out, { synchronizedOutput: true });
    screen.enter();
    screen.render(['a']);
    expect(writes.at(-1)).toBe('\x1b[?2026l');
    expect(writes).toContain('\x1b[?2026h');
  });
});
