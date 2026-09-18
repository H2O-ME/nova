import { describe, expect, it } from 'vitest';
import { LineScreen, sanitizeForDisplay } from '../src/index.js';

describe('sanitizeForDisplay', () => {
  it('keeps SGR sequences verbatim (our palette and colored tool output)', () => {
    expect(sanitizeForDisplay('\x1b[31mred\x1b[0m')).toBe('\x1b[31mred\x1b[0m');
    expect(sanitizeForDisplay('\x1b[2m中文\x1b[0m')).toBe('\x1b[2m中文\x1b[0m');
    // PowerShell $PSStyle truecolor: parameters may carry ; - keep.
    expect(sanitizeForDisplay('\x1b[38;2;255;0;0mx\x1b[0m')).toBe('\x1b[38;2;255;0;0mx\x1b[0m');
  });

  it('strips non-SGR CSI: erases, cursor moves, private modes', () => {
    expect(sanitizeForDisplay('a\x1b[2Kb')).toBe('ab');
    expect(sanitizeForDisplay('\x1b[1;1H\x1b[?25hhi')).toBe('hi');
    expect(sanitizeForDisplay('\x1b[Aup')).toBe('up');
    // Git Bash `grep --color=always` interleaves SGR with EL — SGR rides on,
    // the erase drops out.
    expect(sanitizeForDisplay('\x1b[01;31m\x1b[Kmatch\x1b[0m')).toBe('\x1b[01;31mmatch\x1b[0m');
  });

  it('strips OSC sequences including the terminator', () => {
    expect(sanitizeForDisplay('\x1b]0;window title\x07text')).toBe('text');
    expect(sanitizeForDisplay('\x1b]8;;https://x\x1b\\link')).toBe('link');
    // Unterminated OSC must not leave a stray ESC on screen.
    expect(sanitizeForDisplay('t\x1b]0;abc')).not.toContain('\x1b');
  });

  it('drops stray ESC and control bytes without ever adding newlines', () => {
    // ESC + one byte is a complete (legacy) escape sequence: consumed whole.
    expect(sanitizeForDisplay('a\x1bb')).toBe('a');
    expect(sanitizeForDisplay('a\x1b')).toBe('a'); // bare trailing ESC
    expect(sanitizeForDisplay('bell\x07\x7f\x9b')).toBe('bell');
    // \r\n normalizes to \n; a lone \r disappears — sanitize never grows the
    // line count (that would scroll the alternate screen and desync the diff).
    expect(sanitizeForDisplay('a\r\nb')).toBe('a\nb');
    expect(sanitizeForDisplay('10%\r50%\r100%')).toBe('10%50%100%');
    expect(sanitizeForDisplay('x\ry').split('\n')).toHaveLength(1);
  });

  it('expands tabs to fixed-width spaces', () => {
    expect(sanitizeForDisplay('a\tb')).toBe('a    b');
  });

  it('is idempotent and passes clean text through untouched', () => {
    const dirty = '\x1b[2Kfoo\x07\r\n\x1b[32mbar';
    const once = sanitizeForDisplay(dirty);
    expect(sanitizeForDisplay(once)).toBe(once);
    const clean = 'plain 文本\nstyled\x1b[1mbold\x1b[0m';
    expect(sanitizeForDisplay(clean)).toBe(clean);
  });
});

describe('LineScreen choke point', () => {
  function fakeOut(rows: number, cols: number) {
    const writes: string[] = [];
    const out = {
      rows,
      columns: cols,
      write(s: string) {
        writes.push(s);
      },
    };
    return { out, writes } as unknown as {
      out: NodeJS.WriteStream & { write(s: string): unknown };
      writes: string[];
    };
  }

  it('never lets an unmodeled control write reach the terminal', () => {
    const { out, writes } = fakeOut(2, 40);
    const screen = new LineScreen(out);
    screen.enter();
    writes.length = 0;
    screen.render(['evil\x1b[2J\x1b[Htext', '']);
    const body = writes.join('').replace(/\x1b\[\d+;1H\x1b\[0m\x1b\[0K/g, '');
    expect(body).toBe('eviltext');
  });

  it('counts width after sanitizing (no phantom ellipsis from stripped bytes)', () => {
    // 39 visible columns at cols=40 must fit; before sanitizing, the ESC
    // bytes counted into width and the row got chopped with a `…`.
    const { out, writes } = fakeOut(2, 40);
    const screen = new LineScreen(out);
    screen.enter();
    writes.length = 0;
    const text = 'x'.repeat(39);
    screen.render([`\x1b[2K${text}`, '']);
    const body = writes.join('');
    expect(body).not.toContain('…');
    expect(body).toContain(text);
  });
});
