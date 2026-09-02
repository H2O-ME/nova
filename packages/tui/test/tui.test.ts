import { describe, expect, it } from 'vitest';
import { KeyDecoder, styledWidth, stringWidth, wrapLine, LineScreen } from '../src/index.js';

describe('width', () => {
  it('counts CJK chars as 2 columns and ASCII as 1', () => {
    expect(stringWidth('中文a')).toBe(5);
    expect(stringWidth('hello')).toBe(5);
    expect(stringWidth('ｆｕｌｌ')).toBe(8); // fullwidth
  });

  it('counts East-Asian-ambiguous UI glyphs as 2 columns', () => {
    // On CJK-configured terminals these render 2 cells wide; undercounting
    // makes full-width rows wrap and desyncs the frame.
    expect(stringWidth('·')).toBe(2);
    expect(stringWidth('…')).toBe(2);
    expect(stringWidth('⋯')).toBe(2);
    expect(stringWidth('a · b')).toBe(6); // 1+1+2+1+1: the · alone is 2 columns per the assertion above
  });

  it('ignores ANSI sequences in styledWidth', () => {
    expect(styledWidth('\x1b[2m中文\x1b[0m')).toBe(4);
    expect(styledWidth('\x1b[36mok\x1b[0m')).toBe(2);
  });
});

describe('KeyDecoder', () => {
  const decode = (...chunks: string[]): string[] =>
    chunks.flatMap((c) => new KeyDecoder().push(Buffer.from(c, 'utf8'))).map((k) => k.type);

  it('decodes arrows, control keys and plain chars', () => {
    expect(decode('\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D')).toEqual(['up', 'down', 'right', 'left']);
    expect(decode('\r', '\x7f', '\t', '\x03', '\x04')).toEqual(['enter', 'backspace', 'tab', 'ctrl+c', 'ctrl+d']);
    expect(decode('\x1b[3~', '\x1b[5~', '\x1b[6~', '\x1b[H', '\x1b[F')).toEqual([
      'delete', 'pageup', 'pagedown', 'home', 'end',
    ]);
    expect(decode('h', '你')).toEqual(['char', 'char']);
  });

  it('reassembles sequences split across chunks', () => {
    const decoder = new KeyDecoder();
    expect(decoder.push(Buffer.from('\x1b[', 'utf8'))).toEqual([]);
    expect(decoder.push(Buffer.from('A', 'utf8')).map((k) => k.type)).toEqual(['up']);
  });

  it('decodes multi-byte chars split across chunks', () => {
    const decoder = new KeyDecoder();
    const bytes = Buffer.from('你', 'utf8');
    const first = decoder.push(bytes.subarray(0, 2));
    expect(first).toEqual([]);
    const second = decoder.push(bytes.subarray(2));
    expect(second).toEqual([{ type: 'char', ch: '你' }]);
  });

  it('holds a lone ESC until flushed as the Esc key', () => {
    const decoder = new KeyDecoder();
    expect(decoder.push(Buffer.from('\x1b', 'utf8'))).toEqual([]);
    expect(decoder.hasPendingEsc()).toBe(true);
    expect(decoder.flushPendingEsc()).toEqual({ type: 'esc' });
    expect(decoder.hasPendingEsc()).toBe(false);
    expect(decoder.flushPendingEsc()).toBeUndefined();
  });

  it('reassembles a sequence whose ESC arrived alone in a previous chunk', () => {
    const decoder = new KeyDecoder();
    expect(decoder.push(Buffer.from('\x1b', 'utf8'))).toEqual([]);
    expect(decoder.push(Buffer.from('[B', 'utf8')).map((k) => k.type)).toEqual(['down']);
    expect(decoder.hasPendingEsc()).toBe(false);
    expect(decoder.flushPendingEsc()).toBeUndefined();
  });

  it('decodes bracketed paste as a single paste event', () => {
    const decoder = new KeyDecoder();
    expect(decoder.push(Buffer.from('\x1b[200~你好 world\x1b[201~', 'utf8'))).toEqual([
      { type: 'paste', text: '你好 world' },
    ]);
  });

  it('reassembles bracketed paste split across chunks', () => {
    const decoder = new KeyDecoder();
    expect(decoder.push(Buffer.from('\x1b[200~he', 'utf8'))).toEqual([]);
    expect(decoder.push(Buffer.from('llo\x1b[20', 'utf8'))).toEqual([]);
    expect(decoder.push(Buffer.from('1~', 'utf8'))).toEqual([{ type: 'paste', text: 'hello' }]);
  });
});

describe('wrapLine', () => {
  it('wraps at width preserving ANSI styles', () => {
    const line = '\x1b[2m' + 'a'.repeat(10) + ' ' + 'b'.repeat(10) + '\x1b[0m';
    const wrapped = wrapLine(line, 12);
    expect(wrapped.length).toBe(2);
    expect(wrapped[0]).toContain('\x1b[2m');
    expect(wrapped[1]?.startsWith('\x1b[2m')).toBe(true);
  });

  it('wraps CJK text by display width', () => {
    const wrapped = wrapLine('中文测试文本', 6);
    expect(wrapped.length).toBe(2);
    expect(wrapped[0]).toBe('中文测'); // 3 chars * 2 cols = 6
    expect(wrapped[1]).toBe('试文本');
  });

  it('keeps short lines intact', () => {
    expect(wrapLine('short line', 40)).toEqual(['short line']);
  });

  it('splits embedded newlines into separate rows', () => {
    expect(wrapLine('第一行\n第二行', 40)).toEqual(['第一行', '第二行']);
    expect(wrapLine('a\nb\nc', 40)).toEqual(['a', 'b', 'c']);
  });

  it('keeps blank rows from double newlines', () => {
    expect(wrapLine('a\n\nb', 40)).toEqual(['a', '', 'b']);
  });

  it('normalizes CRLF and lone CR to plain rows', () => {
    expect(wrapLine('a\r\nb', 40)).toEqual(['a', 'b']);
    expect(wrapLine('a\rb', 40)).toEqual(['a', 'b']);
  });

  it('wraps each embedded line independently', () => {
    expect(wrapLine('aaaa\nbbbb', 4)).toEqual(['aaaa', 'bbbb']);
    expect(wrapLine('中文测试\n第二行', 6)).toEqual(['中文测', '试', '第二行']);
  });

  it('carries open ANSI styles across embedded newlines', () => {
    const rows = wrapLine('\x1b[2mline1\nline2\x1b[0m', 40);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('line1');
    expect(rows[1]?.startsWith('\x1b[2m')).toBe(true);
    expect(rows[1]).toContain('line2');
  });

  it('resets styles at newline so the next row starts clean', () => {
    const rows = wrapLine('\x1b[2mdim\n\x1b[0mbright', 40);
    // carried prefix is immediately closed by the source's own reset
    expect(rows[1]).toBe('\x1b[2m\x1b[0mbright');
  });
});

describe('LineScreen', () => {
  function fakeOut(rows: number, cols: number) {
    const writes: string[] = [];
    const out = {
      rows,
      columns: cols,
      write(s: string) {
        writes.push(s);
      },
    };
    return { out, writes } as unknown as { out: NodeJS.WriteStream & { write(s: string): unknown }; writes: string[] };
  }

  it('only rewrites changed lines between frames', () => {
    const { out, writes } = fakeOut(4, 40);
    const screen = new LineScreen(out);
    screen.enter();
    writes.length = 0;
    screen.render(['a', 'b', 'c', 'd']);
    const afterFirst = writes.length;
    writes.length = 0;
    screen.render(['a', 'B', 'c', 'd']);
    expect(writes.length).toBeLessThan(afterFirst);
    expect(writes.join('')).toContain('B');
    expect(writes.join('')).not.toContain('\x1b[1;1Ha');
  });

  it('places the hardware cursor', () => {
    const { out, writes } = fakeOut(4, 40);
    const screen = new LineScreen(out);
    screen.enter();
    writes.length = 0;
    screen.render(['a', 'b', 'c', 'd'], { row: 2, col: 5 });
    expect(writes.at(-1)).toBe('\x1b[3;6H');
  });

  it('resets SGR before erasing each rewritten line', () => {
    const { out, writes } = fakeOut(2, 40);
    const screen = new LineScreen(out);
    screen.enter();
    writes.length = 0;
    screen.render(['a', 'b']);
    expect(writes.join('')).toContain('\x1b[1;1H\x1b[0m\x1b[0Ka');
  });

  it('toggles bracketed paste mode with the screen', () => {
    const { out, writes } = fakeOut(2, 40);
    const screen = new LineScreen(out);
    screen.enter();
    screen.exit();
    const all = writes.join('');
    expect(all.indexOf('\x1b[?2004h')).toBeGreaterThanOrEqual(0);
    expect(all.indexOf('\x1b[?2004l')).toBeGreaterThan(all.indexOf('\x1b[?2004h'));
  });
});
