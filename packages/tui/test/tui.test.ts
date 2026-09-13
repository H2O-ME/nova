import { describe, expect, it } from 'vitest';
import { KeyDecoder, styledWidth, stringWidth, wrapLine, LineScreen } from '../src/index.js';

describe('width', () => {
  it('counts CJK chars as 2 columns and ASCII as 1', () => {
    expect(stringWidth('中文a')).toBe(5);
    expect(stringWidth('hello')).toBe(5);
    expect(stringWidth('ｆｕｌｌ')).toBe(8); // fullwidth
  });

  it('counts East-Asian-ambiguous UI glyphs as 2 columns', () => {
    // These glyphs only ever appear in short left-aligned rows (tool lines,
    // status bar, hints), so the conservative 2 can only truncate cosmetics,
    // never wrap the frame.
    expect(stringWidth('…')).toBe(2);
    expect(stringWidth('⋯')).toBe(2);
    expect(stringWidth('✓')).toBe(2); // tool done marker
    expect(stringWidth('✗')).toBe(2); // tool failure marker
    expect(stringWidth('⟳')).toBe(2); // retry line
    expect(stringWidth('⠋')).toBe(2); // braille spinner frames
    expect(stringWidth('🚀')).toBe(2); // emoji outside the old narrow range
  });

  it('counts box drawing, arrows and middle dot as 1 column', () => {
    // Windows Terminal (and modern terminals generally) render ambiguous
    // glyphs one cell wide. The popup boxes assemble full-width border rows
    // from these chars via styledWidth; counting 2 made every row overflow
    // the safe width, so the renderer chopped the right border and painted
    // `…` mid-row (the half-drawn palette bug).
    expect(stringWidth('─')).toBe(1);
    expect(stringWidth('│')).toBe(1);
    expect(stringWidth('╭')).toBe(1);
    expect(stringWidth('→')).toBe(1);
    expect(stringWidth('↑')).toBe(1);
    expect(stringWidth('↓')).toBe(1);
    expect(stringWidth('·')).toBe(1);
    expect(stringWidth('❯')).toBe(1); // composer prompt — feeds caret column math
    expect(stringWidth('█')).toBe(1); // context bar
    expect(stringWidth('░')).toBe(1);
    expect(stringWidth('a · b')).toBe(5);
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

  it('ESC + trailing byte (Alt chord / garbage) never emits an esc keypress', () => {
    // A genuine Esc press is ALWAYS a lone ESC (pending-flush path). This
    // fallback used to return `esc` — and Esc aborts a running turn, so any
    // unrecognized byte after ESC became a phantom interrupt.
    expect(decode('\x1bc')).toEqual(['char']); // Alt+C decodes as plain c
    expect(decode('\x1b\x1b[B')).toEqual(['down']); // double-ESC then arrow
    expect(decode('\x1b9')).toEqual(['char']); // digit after ESC
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

  it('decodes SGR mouse wheel notches and left clicks, swallows the rest', () => {
    expect(decode('\x1b[<64;12;3M')).toEqual(['wheelup']);
    expect(decode('\x1b[<65;12;3M')).toEqual(['wheeldown']);
    // bare left-press becomes a coordinate click; its release and a wheel
    // release stay silent — nothing may leak into the composer as phantom keys
    expect(decode('\x1b[<0;5;5M', '\x1b[<0;5;5m', '\x1b[<64;1;1m')).toEqual(['click']);
    expect(new KeyDecoder().push(Buffer.from('\x1b[<0;12;7M', 'utf8'))).toEqual([
      { type: 'click', x: 12, y: 7 },
    ]);
    // right/middle press, drag motion, modified press: still swallowed
    expect(decode('\x1b[<2;5;5M', '\x1b[<1;5;5M', '\x1b[<32;5;5M', '\x1b[<4;5;5M')).toEqual([]);
    // sequences split across chunks still decode
    const decoder = new KeyDecoder();
    expect(decoder.push(Buffer.from('\x1b[<6', 'utf8'))).toEqual([]);
    expect(decoder.push(Buffer.from('4;1;1M', 'utf8')).map((k) => k.type)).toEqual(['wheelup']);
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

describe('truncateStyled safety net', () => {
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

  it('keeps the ellipsis inside the safe width instead of overflowing by one', () => {
    // safeCols = 9: the old implementation kept 8 chars then appended the
    // 2-column ellipsis → 10 columns → wrap → frame desync.
    const { out, writes } = fakeOut(2, 10);
    const screen = new LineScreen(out);
    screen.enter();
    writes.length = 0;
    screen.render(['a'.repeat(20), '']);
    const line = writes.find((w) => w.includes('aaa')) ?? '';
    // eslint-disable-next-line no-control-regex
    const written = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    expect(written).toBe('aaaaaaa…'); // 7 + ellipsis = exactly 9 columns
  });

  it('leaves full-width popup border rows untruncated', () => {
    // The command palette / model picker compose their border to exactly
    // cols-1 columns out of box-drawing chars; the renderer must pass them
    // through untouched (no trailing `…`, right corner intact).
    const { out, writes } = fakeOut(3, 60);
    const screen = new LineScreen(out);
    screen.enter();
    writes.length = 0;
    const top = '╭─ 命令 ' + '─'.repeat(50) + '╮';
    const hint = '↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭';
    const bottom = '╰' + hint + '─'.repeat(57 - stringWidth(hint)) + '╯';
    expect(stringWidth(top)).toBe(59); // cols-1 = safeCols, exactly fits
    expect(stringWidth(bottom)).toBe(59);
    screen.render([top, bottom, '']);
    const clean = (marker: string): string => {
      const line = writes.find((w) => w.includes(marker)) ?? '';
      // eslint-disable-next-line no-control-regex
      return line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    };
    expect(clean('命令')).toBe(top);
    expect(clean('补全')).toBe(bottom);
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

  it('enables and disables wheel mouse tracking with the screen', () => {
    const { out, writes } = fakeOut(2, 40);
    const screen = new LineScreen(out);
    screen.enter();
    screen.exit();
    const all = writes.join('');
    expect(all.indexOf('\x1b[?1000h')).toBeGreaterThanOrEqual(0);
    expect(all.indexOf('\x1b[?1006h')).toBeGreaterThan(all.indexOf('\x1b[?1000h'));
    expect(all.indexOf('\x1b[?1000l')).toBeGreaterThan(all.indexOf('\x1b[?1006h'));
  });
});

describe('wrapLine: CJK break opportunities', () => {
  const widthOf = (row: string): number => [...row].reduce((a, c) => a + (c.charCodeAt(0) > 0xff ? 2 : 1), 0);

  it('fills the line through unbroken CJK runs instead of wrapping early at the last space', () => {
    // Old word-based wrap treated the whole CJK clause as one "word": line 1
    // stopped at "跑 " and half the row stayed empty.
    const line = '我主要做本地编码和文件操作：读写和分析代码、跑 git/构建/测试命令，也能帮你查资料';
    const rows = wrapLine(line, 40);
    expect(widthOf(rows[0]!)).toBe(40);
    expect(rows[0]!.endsWith('跑')).toBe(false);
  });

  it('keeps latin words atomic while breaking between CJK chars', () => {
    const rows = wrapLine('中文文文文文 git-command 文文文文文文', 12);
    expect(rows.some((r) => r.includes('git-command'))).toBe(true);
    for (const row of rows) expect(widthOf(row)).toBeLessThanOrEqual(12);
  });

  it('never starts a line with closing punctuation', () => {
    const rows = wrapLine('一句话到这里结束。下一句接着说，再来一点内容把行挤满。', 10);
    for (const row of rows.slice(1)) {
      expect('，。、；：！？…').not.toContain(row[0]);
    }
  });
});
