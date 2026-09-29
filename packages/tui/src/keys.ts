/** Raw stdin key decoding: bytes in, semantic key events out. */

export type Key =
  | { type: 'char'; ch: string }
  | { type: 'paste'; text: string }
  | { type: 'enter' }
  /** Alt/Meta+Enter newline (kitty / WezTerm / Windows Terminal `pb0B`). */
  | { type: 'newline' }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'left' }
  | { type: 'right' }
  /** Ctrl+方向（CSI `1;5C/D`）：composer 词级移动。 */
  | { type: 'ctrl+left' }
  | { type: 'ctrl+right' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'pageup' }
  | { type: 'pagedown' }
  | { type: 'wheelup' }
  | { type: 'wheeldown' }
  /** Left-button press at 1-based cell coords (SGR `0;col;rowM`). */
  | { type: 'click'; x: number; y: number }
  /** No-button hover motion at 1-based cell coords (SGR `35;col;rowM`,
   *  DEC ?1003). Consumed by status-bar hover hit-testing; drags stay silent. */
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'tab' }
  | { type: 'shifttab' }
  /** DEC 1004 focus reports (`CSI I` / `CSI O`) — the shell re-asserts mouse
   * capture on focusin (Windows ConPTY can silently strip the private modes,
   * degrading SGR mouse to X10 and painting escape garbage into the frame). */
  | { type: 'focusin' }
  | { type: 'focusout' }
  | { type: 'esc' }
  | { type: 'ctrl+c' }
  | { type: 'ctrl+d' }
  | { type: 'ctrl+u' }
  | { type: 'ctrl+w' };

/** One UTF-8 aware, escape-sequence aware decoder; feed stdin chunks. */
export class KeyDecoder {
  private buf: number[] = [];
  private inPaste = false;
  private escPending = false;

  push(chunk: Buffer): Key[] {
    this.escPending = false;
    for (const byte of chunk) this.buf.push(byte);
    const keys: Key[] = [];
    for (;;) {
      const key = this.readKey();
      if (key === undefined) break;
      keys.push(key);
    }
    return keys;
  }

  /** True while a lone ESC waits at the buffer head for disambiguation. */
  hasPendingEsc(): boolean {
    return this.escPending;
  }

  /** Emit the buffered lone ESC as the Esc key; call after a short timeout. */
  flushPendingEsc(): Key | undefined {
    this.escPending = false;
    if (this.buf.length === 1 && this.buf[0] === 0x1b) {
      this.take(1);
      return { type: 'esc' };
    }
    return undefined;
  }

  private take(n: number): number[] {
    return this.buf.splice(0, n);
  }

  private readKey(): Key | undefined {
    if (this.inPaste) return this.readPaste();
    const b0 = this.buf[0];
    if (b0 === undefined) return undefined;

    if (b0 === 0x1b) {
      return this.readEscape();
    }
    if (b0 === 0x0d || b0 === 0x0a) {
      // Alt/Meta+Enter newline: ESC+CR (`\x1b\r`), sent by kitty / WezTerm /
      // Windows Terminal alongside its CSI-u `pb0B` form (decoded below).
      if (b0 === 0x0d && this.buf[1] === 0x1b) {
        this.take(2);
        return { type: 'newline' };
      }
      this.take(1);
      return { type: 'enter' };
    }
    if (b0 === 0x7f || b0 === 0x08) {
      this.take(1);
      return { type: 'backspace' };
    }
    if (b0 === 0x09) {
      this.take(1);
      return { type: 'tab' };
    }
    if (b0 === 0x03) {
      this.take(1);
      return { type: 'ctrl+c' };
    }
    if (b0 === 0x04) {
      this.take(1);
      return { type: 'ctrl+d' };
    }
    if (b0 === 0x15) {
      this.take(1);
      return { type: 'ctrl+u' };
    }
    if (b0 === 0x17) {
      this.take(1);
      return { type: 'ctrl+w' };
    }
    if (b0 < 0x20) {
      this.take(1);
      return undefined; // other control bytes: ignore
    }

    // UTF-8 multibyte
    let length = 1;
    if (b0 >= 0xc2 && b0 <= 0xdf) length = 2;
    else if (b0 >= 0xe0 && b0 <= 0xef) length = 3;
    else if (b0 >= 0xf0 && b0 <= 0xf4) length = 4;
    if (this.buf.length < length) return undefined; // wait for the rest
    const seq = this.take(length);
    const ch = Buffer.from(seq).toString('utf8');
    return { type: 'char', ch };
  }

  private readEscape(): Key | undefined {
    if (this.buf.length < 2) {
      // A lone ESC is either the Esc key or the head of a sequence whose rest
      // arrives in the next chunk; hold it so the consumer can flush it as
      // Esc via flushPendingEsc() once no continuation shows up.
      this.escPending = true;
      return undefined;
    }
    const b1 = this.buf[1];
    if (b1 === undefined) return undefined;

    if (b1 === 0x5b) {
      // CSI: ESC [ params final
      let i = 2;
      while (i < this.buf.length) {
        const byte = this.buf[i];
        if (byte === undefined) return undefined;
        const isFinal = (byte >= 0x40 && byte <= 0x7e) && !(byte >= 0x30 && byte <= 0x3f);
        if (isFinal) break;
        i += 1;
      }
      if (i >= this.buf.length) return undefined; // incomplete, wait
      const seq = this.take(i + 1);
      const finalRaw = seq[i];
      if (finalRaw === undefined) return undefined;
      const finalByte = String.fromCharCode(finalRaw);
      const params = Buffer.from(seq.slice(2, i)).toString('ascii');
      switch (finalByte) {
        case 'A':
          return { type: 'up' };
        case 'B':
          return { type: 'down' };
        case 'C':
          return arrowKey(params, 'right');
        case 'D':
          return arrowKey(params, 'left');
        case 'H':
          return arrowKey(params, 'home');
        case 'F':
          return arrowKey(params, 'end');
        case 'Z':
          return { type: 'shifttab' };
        case 'I':
          return { type: 'focusin' }; // DEC 1004 focus report
        case 'O':
          return { type: 'focusout' };
        case 'M':
        case 'm':
          // SGR mouse mode (?1006h): `ESC [ < btn ; col ; row M/m`. Wheel
          // notches arrive as button 64/65 presses, left clicks as button 0;
          // drags and other buttons are consumed silently so they never
          // leak into the composer.
          return parseMouseButton(params, finalByte);
        case '~':
          if (params === '200') {
            this.inPaste = true;
            return this.readPaste();
          }
          if (params === '1' || params === '7') return { type: 'home' };
          if (params === '3') return { type: 'delete' };
          if (params === '4' || params === '8') return { type: 'end' };
          if (params === '5') return { type: 'pageup' };
          if (params === '6') return { type: 'pagedown' };
          if (params === '13') return { type: 'enter' };
          // CSI-u / kitty progressive-enhancement form of Alt+Enter
          // (`ESC [ 13 ; 3 u`); also accept bare `ESC [ 13 u` encodings.
          if (/^13(;\d+)*u$/.test(`[${params}`) || params === '13u' || params.endsWith(';13u')) {
            return { type: 'newline' };
          }
          return undefined;
        case 'u':
          // kitty keyboard protocol Alt+Enter: `ESC [ 13 ; 3 u`.
          if (params === '13;3' || params === '13') return { type: 'newline' };
          return undefined;
        default:
          return undefined;
      }
    }
    if (b1 === 0x4f) {
      // SS3: ESC O X
      const b2 = this.buf[2];
      if (b2 === undefined) return undefined;
      const ch = String.fromCharCode(b2);
      this.take(3);
      if (ch === 'H') return { type: 'home' };
      if (ch === 'F') return { type: 'end' };
      if (ch === 'A') return { type: 'up' };
      if (ch === 'B') return { type: 'down' };
      if (ch === 'C') return { type: 'right' };
      if (ch === 'D') return { type: 'left' };
      return undefined;
    }
    // ESC followed by anything else (Alt+char chords, fragmented garbage):
    // drop the ESC and decode the rest. A GENUINE Esc keypress always
    // arrives as a lone ESC and goes through the pending-flush path above —
    // this fallback can never see one. Emitting `esc` here used to abort a
    // running turn on any unrecognized byte after ESC. Recurse (never return
    // undefined — that means "need more bytes" and would stall the drain
    // loop with bytes still in the buffer); each step consumes ≥1 byte.
    this.take(1);
    return this.readKey();
  }

  /** Bracketed paste body: `\x1b[200~` was consumed; collect up to `\x1b[201~`. */
  private readPaste(): Key | undefined {
    const end = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e];
    outer: for (let j = 0; j + end.length <= this.buf.length; j++) {
      for (let k = 0; k < end.length; k++) {
        if (this.buf[j + k] !== end[k]) continue outer;
      }
      const text = Buffer.from(this.buf.slice(0, j)).toString('utf8');
      this.take(j + end.length);
      this.inPaste = false;
      return { type: 'paste', text };
    }
    // Safety valve: a paste whose terminator never arrives (broken transport,
    // mode toggled mid-paste) would otherwise swallow every future keystroke.
    if (this.buf.length > 1_000_000) {
      const text = Buffer.from(this.buf).toString('utf8');
      this.buf.length = 0;
      this.inPaste = false;
      return { type: 'paste', text };
    }
    return undefined; // keep buffering until the terminator arrives
  }
}

/**
 * SGR mouse event → keys. `params` is the raw `<btn;col;row` string and
 * `final` distinguishes press (`M`) from release (`m`). Wheel notches
 * (64 = up, 65 = down) become wheel keys; a bare left-button press
 * (button 0) becomes a coordinate `click` for transcript hit-testing; a
 * no-button motion (35, DEC ?1003) becomes `mousemove`. Releases, drags,
 * modified and other buttons are consumed so enabling tracking never
 * injects phantom input.
 */
/**
 * CSI 方向键修饰键参数（`1;5C` 的 5 = ctrl；`1;2`=shift、`1;3`=alt）→
 * 词级移动用的 ctrl+left/right；其余修饰组合回落普通方向（此前整个参数
 * 被丢弃，ctrl+right 被静默解成 right，词移动无法实现）。
 */
function arrowKey(params: string, base: 'left' | 'right' | 'up' | 'down' | 'home' | 'end'): Key {
  if (params === '1;5' || params === '5') {
    if (base === 'left') return { type: 'ctrl+left' };
    if (base === 'right') return { type: 'ctrl+right' };
  }
  return { type: base };
}

function parseMouseButton(params: string, final: string): Key | undefined {
  if (final !== 'M') return undefined; // release / motion-end: ignore
  if (!params.startsWith('<')) return undefined; // legacy X10 encoding: not ours
  const parts = params.slice(1).split(';');
  const button = Number.parseInt(parts[0] ?? '', 10);
  const coord = (xRaw: string | undefined, yRaw: string | undefined): { x: number; y: number } | undefined => {
    const x = Number.parseInt(xRaw ?? '', 10);
    const y = Number.parseInt(yRaw ?? '', 10);
    return Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 ? { x, y } : undefined;
  };
  if (button === 64) return { type: 'wheelup' };
  if (button === 65) return { type: 'wheeldown' };
  if (button === 35) {
    // ?1003 hover motion (no button held): drags (32/33/…) stay swallowed.
    const c = coord(parts[1], parts[2]);
    return c === undefined ? undefined : { type: 'mousemove', ...c };
  }
  if (button === 0) {
    const c = coord(parts[1], parts[2]);
    if (c !== undefined) return { type: 'click', ...c };
  }
  return undefined;
}
