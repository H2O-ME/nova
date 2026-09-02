/** Raw stdin key decoding: bytes in, semantic key events out. */

export type Key =
  | { type: 'char'; ch: string }
  | { type: 'paste'; text: string }
  | { type: 'enter' }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'pageup' }
  | { type: 'pagedown' }
  | { type: 'tab' }
  | { type: 'shifttab' }
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
          return { type: 'right' };
        case 'D':
          return { type: 'left' };
        case 'H':
          return { type: 'home' };
        case 'F':
          return { type: 'end' };
        case 'Z':
          return { type: 'shifttab' };
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
    // ESC followed by anything else: treat ESC as Esc key, retry the rest.
    this.take(1);
    return { type: 'esc' };
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
