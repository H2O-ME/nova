import { describe, expect, it } from 'vitest';
import { detectCaps, KeyDecoder, LineScreen } from '../src/index.js';

describe('detectCaps', () => {
  it('NO_COLOR forces plain regardless of TTY', () => {
    const caps = detectCaps({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true, 'win32');
    expect(caps.color).toBe(false);
    expect(caps.truecolor).toBe(false);
  });

  it('non-TTY output never gets color or sync output', () => {
    const caps = detectCaps({ TERM: 'xterm-256color' }, false, 'win32');
    expect(caps).toEqual({ color: false, truecolor: false, synchronizedOutput: false });
  });

  it('TERM=dumb is treated as colorless', () => {
    expect(detectCaps({ TERM: 'dumb' }, true, 'win32').color).toBe(false);
  });

  it('COLORTERM=truecolor upgrades to 24-bit on a TTY', () => {
    const caps = detectCaps({ COLORTERM: 'truecolor', TERM: 'xterm' }, true, 'linux');
    expect(caps).toEqual({ color: true, truecolor: true, synchronizedOutput: true });
  });

  it('plain TTY without COLORTERM stays 16-color', () => {
    const caps = detectCaps({ TERM: 'xterm' }, true, 'linux');
    expect(caps.color).toBe(true);
    expect(caps.truecolor).toBe(false);
    expect(caps.synchronizedOutput).toBe(true);
  });

  it('truecolor 品牌表补环境变量漏报（Grok 同款升回）', () => {
    expect(detectCaps({ TERM_PROGRAM: 'Windows Terminal', TERM: 'xterm-256color' }, true, 'linux').truecolor).toBe(true);
    expect(detectCaps({ TERM_PROGRAM: 'tmux', TERM: 'xterm' }, true, 'linux').truecolor).toBe(false);
    // Windows 无条件为真：ConHost 自 Win10 起就吃 38;2，而它什么都不报。
    expect(detectCaps({ TERM: 'xterm' }, true, 'win32').truecolor).toBe(true);
  });

  it('tmux disables synchronized output (pane-wide repaint at block close)', () => {
    expect(detectCaps({ TERM_PROGRAM: 'tmux', COLORTERM: 'truecolor' }, true).synchronizedOutput).toBe(false);
    expect(detectCaps({ TMUX: '/tmp/tmux-1000/default,1234,0' }, true).synchronizedOutput).toBe(false);
    // …but color stays on inside tmux — only the sync wrapper is gated.
    expect(detectCaps({ TERM_PROGRAM: 'tmux', COLORTERM: 'truecolor' }, true).truecolor).toBe(true);
  });
});

describe('KeyDecoder focus reports (DEC 1004)', () => {
  it('decodes CSI I / CSI O as focusin / focusout', () => {
    const d = new KeyDecoder();
    expect(d.push(Buffer.from('\x1b[I', 'utf8')).map((k) => k.type)).toEqual(['focusin']);
    expect(d.push(Buffer.from('\x1b[O', 'utf8')).map((k) => k.type)).toEqual(['focusout']);
  });
});

describe('LineScreen mode toggles', () => {
  function fakeOut(): { out: NodeJS.WriteStream & { write(s: string): unknown }; writes: string[] } {
    const writes: string[] = [];
    const out = { write: (s: string) => writes.push(s) } as never;
    return { out, writes };
  }

  it('enables focus reports on enter and disables them last-ish on exit', () => {
    const { out, writes } = fakeOut();
    const screen = new LineScreen(out);
    screen.enter();
    expect(writes).toContain('\x1b[?1004h');
    writes.length = 0;
    screen.exit();
    expect(writes).toContain('\x1b[?1004l');
  });

  it('reassertModes re-emits mouse and focus modes without touching the frame', () => {
    const { out, writes } = fakeOut();
    const screen = new LineScreen(out);
    screen.render(['x', 'y']);
    writes.length = 0;
    screen.reassertModes();
    expect(writes).toEqual(['\x1b[?1000h', '\x1b[?1003h', '\x1b[?1006h', '\x1b[?1004h']);
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

describe('KeyDecoder ctrl+arrows (CSI modifier params)', () => {
  it('decodes 1;5C / 1;5D as ctrl+right / ctrl+left', () => {
    const d = new KeyDecoder();
    expect(d.push(Buffer.from('\x1b[1;5C', 'utf8')).map((k) => k.type)).toEqual(['ctrl+right']);
    expect(d.push(Buffer.from('\x1b[1;5D', 'utf8')).map((k) => k.type)).toEqual(['ctrl+left']);
  });

  it('plain arrows are unchanged; other modifiers fall back to base arrows', () => {
    const d = new KeyDecoder();
    expect(d.push(Buffer.from('\x1b[C', 'utf8')).map((k) => k.type)).toEqual(['right']);
    expect(d.push(Buffer.from('\x1b[1;2C', 'utf8')).map((k) => k.type)).toEqual(['right']);
    expect(d.push(Buffer.from('\x1b[1;5A', 'utf8')).map((k) => k.type)).toEqual(['up']);
  });
});
