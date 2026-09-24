/**
 * Markdown INLINE grammar — the pure half of the harness `MarkdownText` port
 * (`ui-primitives/src/markdown/render.tsx`'s phrasing branch + `cjkFriendlyStrong.ts`).
 * A scanner rather than a regex sweep: every construct is consumed atomically
 * at the index it starts, so a code span can never be re-matched by the
 * emphasis rules that follow it (the bug the TUI renderer shipped and had to
 * paper over with placeholders).
 *
 * Ported semantics that matter:
 *  - **CJK-friendly strong.** The harness extends micromark's attention rule so
 *    `**` may close after punctuation when CJK prose continues without a space
 *    (`这是**重点**。`), which plain CommonMark leaves literal. That rule is
 *    {@link closesRun} here, asserted directly.
 *  - **Untrusted destinations.** Links pass a protocol allowlist
 *    (`http`/`https`/`mailto`, exactly the harness's set) and images require an
 *    absolute HTTP(S) URL; anything else stays literal text. No HTML path
 *    exists: raw HTML in the source is text, and the renderer emits elements
 *    only.
 */

/** One inline token; the renderer is a dumb projection of this tree. */
export type InlineNode =
  | { t: 'text'; value: string }
  | { t: 'br' }
  | { t: 'code'; value: string; href?: string }
  | { t: 'strong'; children: InlineNode[] }
  | { t: 'em'; children: InlineNode[] }
  | { t: 'del'; children: InlineNode[] }
  | { t: 'link'; href: string; children: InlineNode[]; glyph: boolean }
  | { t: 'image'; url: string | undefined; alt: string; destination: string };

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|~<>');

/** Parse one inline run (a paragraph line set, a heading, a table cell). */
export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = '';
  let i = 0;
  const flush = (): void => {
    if (buf.length > 0) out.push({ t: 'text', value: buf });
    buf = '';
  };
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === '\n') {
        flush();
        out.push({ t: 'br' });
        i += 2;
        continue;
      }
      if (next !== undefined && ESCAPABLE.has(next)) {
        buf += next;
        i += 2;
        continue;
      }
    }
    if (ch === '`') {
      const span = readCodeSpan(text, i);
      if (span !== null) {
        flush();
        out.push(span.node);
        i = span.end;
        continue;
      }
    }
    if (ch === '!' && text[i + 1] === '[') {
      const image = readImage(text, i);
      if (image !== null) {
        flush();
        out.push(image.node);
        i = image.end;
        continue;
      }
    }
    if (ch === '[') {
      const link = readLink(text, i);
      if (link !== null) {
        flush();
        out.push(link.node);
        i = link.end;
        continue;
      }
    }
    if (ch === '<') {
      const auto = readAutolink(text, i);
      if (auto !== null) {
        flush();
        out.push(auto.node);
        i = auto.end;
        continue;
      }
    }
    if ((ch === '*' || ch === '_' || ch === '~') && !(ch === '~' && text[i + 1] !== '~')) {
      const run = readEmphasis(text, i, ch);
      if (run !== null) {
        flush();
        out.push(run.node);
        i = run.end;
        continue;
      }
    }
    if (ch === '\n') {
      // A hard break is two trailing spaces (or a backslash, handled above).
      if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, '');
        flush();
        out.push({ t: 'br' });
      } else {
        // Soft break: kept as a newline in the text run, exactly like the
        // harness's interleaved newline text nodes (CSS collapses it later).
        buf += '\n';
      }
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/**
 * Inline code: a run of `n` backticks closes on the next run of exactly `n`.
 * Line endings become spaces (mdast-util-to-hast parity) and one wrapping
 * space pair is stripped unless the content is all spaces.
 */
function readCodeSpan(text: string, start: number): { node: InlineNode; end: number } | null {
  let open = 0;
  while (text[start + open] === '`') open += 1;
  let i = start + open;
  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    let close = 0;
    while (text[i + close] === '`') close += 1;
    if (close === open) {
      let value = text.slice(start + open, i).replace(/\r?\n|\r/g, ' ');
      if (value.length > 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim().length > 0) {
        value = value.slice(1, -1);
      }
      const href = inlineCodeHttpUrl(value);
      // An inline-code token that IS an absolute HTTP(S) URL keeps its code
      // chrome and gains the same safe external anchor a link gets; commands,
      // partial URLs and other schemes stay inert.
      return { node: href === undefined ? { t: 'code', value } : { t: 'code', value, href }, end: i + close };
    }
    i += close;
  }
  return null;
}

function readImage(text: string, start: number): { node: InlineNode; end: number } | null {
  const label = readBracket(text, start + 1);
  if (label === null || text[label.end] !== '(') return null;
  const destination = readDestination(text, label.end);
  if (destination === null) return null;
  // The image is parsed whatever its destination says; whether it can be
  // DISPLAYED is the renderer's call (a local path or a non-HTTP scheme falls
  // back to the alt text, the harness `imageSource` miss).
  return {
    node: {
      t: 'image',
      url: remoteImageUrl(sanitizeUrl(normalizeUri(destination.url))),
      alt: plainText(label.inner),
      destination: destination.url,
    },
    end: destination.end,
  };
}

function readLink(text: string, start: number): { node: InlineNode; end: number } | null {
  const label = readBracket(text, start);
  if (label === null || text[label.end] !== '(') return null;
  const destination = readDestination(text, label.end);
  if (destination === null) return null;
  const href = sanitizeUrl(normalizeUri(destination.url));
  if (href === '') return null;
  const children = parseInline(label.inner);
  // An anchor wrapping only images is a clickable picture: the leading URL
  // glyph would dangle beside it instead of leading link text.
  const onlyImages = children.length > 0 && children.every((child) => child.t === 'image');
  return { node: { t: 'link', href, children, glyph: !onlyImages }, end: destination.end };
}

/** The bracketed label starting at `start`; `end` is the index after `]`. */
function readBracket(text: string, start: number): { inner: string; end: number } | null {
  if (text[start] !== '[') return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** `(destination "title")` after a label; the title is accepted and dropped. */
function readDestination(text: string, start: number): { url: string; end: number } | null {
  if (text[start] !== '(') return null;
  let depth = 1;
  let raw = '';
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (ch === '\\' && text[i + 1] !== undefined) {
      raw += text[i + 1];
      i += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return { url: splitTitle(raw), end: i + 1 };
      }
    }
    raw += ch;
  }
  return null;
}

/** A destination is everything before the optional quoted title. */
function splitTitle(raw: string): string {
  const match = /^(\S*)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.exec(raw.trim());
  return match?.[1] ?? raw.trim();
}

/** `<https://…>` autolinks: the only angle-bracket form that renders a link. */
function readAutolink(text: string, start: number): { node: InlineNode; end: number } | null {
  const close = text.indexOf('>', start);
  if (close === -1) return null;
  const inner = text.slice(start + 1, close);
  const href = sanitizeUrl(normalizeUri(inner));
  if (href === '' || !/^(https?|mailto):/i.test(inner)) return null;
  return { node: { t: 'link', href, children: [{ t: 'text', value: inner }], glyph: true }, end: close + 1 };
}

/**
 * Emphasis, strong and strikethrough. The opening run must be left-flanking
 * and the closing run right-flanking ({@link opensRun}/{@link closesRun}); `~`
 * only ever forms `~~` (GFM has no single-tilde form).
 *
 * A run of three or more delivers both markers at once. Reading only two of them
 * left the remaining delimiter behind as visible text: `***a***` rendered
 * `<strong>*a</strong>*` (the reader saw a literal `*a*`). CommonMark nests the
 * run instead — one level per pair, em outermost when the count is odd — so
 * `***a***` is em(strong(a)) and `****a****` is strong(strong(a)).
 */
function readEmphasis(text: string, start: number, ch: string): { node: InlineNode; end: number } | null {
  if (ch === '~') {
    if (!opensRun(text, start, 2, ch)) return null;
    const close = findClose(text, start + 2, ch, 2);
    if (close === -1) return null;
    const inner = text.slice(start + 2, close);
    if (inner.length === 0) return null;
    return { node: { t: 'del', children: parseInline(inner) }, end: close + 2 };
  }
  const run = runLength(text, start, ch);
  if (run >= 3) {
    const nested = readNestedRun(text, start, run, ch);
    // `***a**` has no matching 3-run: the run is not really a three, so fall
    // through and let the two-marker read below take its `**`.
    if (nested !== null) return nested;
  }
  const length = run >= 2 ? 2 : 1;
  if (!opensRun(text, start, length, ch)) return null;
  const close = findClose(text, start + length, ch, length);
  if (close === -1) return null;
  const inner = text.slice(start + length, close);
  if (inner.length === 0) return null;
  const children = parseInline(inner);
  const node: InlineNode = length === 1 ? { t: 'em', children } : { t: 'strong', children };
  return { node, end: close + length };
}

/** Length of the marker run starting at `at` (0 when the char is not `ch`). */
function runLength(text: string, at: number, ch: string): number {
  let run = 0;
  while (text[at + run] === ch) run += 1;
  return run;
}

/** A 3+-delimiter run closed by an equal run, nested one level per pair. */
function readNestedRun(
  text: string,
  start: number,
  run: number,
  ch: string,
): { node: InlineNode; end: number } | null {
  if (!opensRun(text, start, run, ch)) return null;
  const close = findClose(text, start + run, ch, run);
  if (close === -1) return null;
  const inner = text.slice(start + run, close);
  if (inner.length === 0) return null;
  const pairs = Math.floor(run / 2);
  let node: InlineNode = { t: 'strong', children: parseInline(inner) };
  for (let level = 1; level < pairs; level += 1) node = { t: 'strong', children: [node] };
  // An odd run leaves one delimiter to open the outer emphasis.
  const wrapped: InlineNode = run % 2 === 1 ? { t: 'em', children: [node] } : node;
  return { node: wrapped, end: close + run };
}

/** Scan for the closing run of the same marker (index of the run, or -1). */
function findClose(text: string, from: number, ch: string, length: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === ch) {
      let run = 0;
      while (text[i + run] === ch) run += 1;
      if (run >= length && closesRun(text, i, length, ch)) return i;
      i += run;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** Left-flanking (micromark's `_open`): may open emphasis. */
export function opensRun(text: string, start: number, length: number, ch: string): boolean {
  const before = start === 0 ? undefined : text[start - 1];
  const after = text[start + length];
  if (isSpace(after)) return false;
  if (ch === '_' && before !== undefined && isWord(before)) return false;
  return !isPunct(after) || before === undefined || isSpace(before) || isPunct(before);
}

/** Right-flanking (micromark's `_close`) plus the harness CJK strong extension. */
export function closesRun(text: string, start: number, length: number, ch: string): boolean {
  const before = start === 0 ? undefined : text[start - 1];
  const after = text[start + length];
  if (isSpace(before)) return false;
  if (ch === '_' && after !== undefined && isWord(after)) return false;
  const commonMark = !isPunct(before) || isSpace(after) || isPunct(after);
  // cjkFriendlyStrong: let asterisk strong close after punctuation when CJK
  // prose continues without whitespace.
  const cjkStrong = ch === '*' && length >= 2 && isPunct(before) && isCjk(after);
  return commonMark || cjkStrong;
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

function isPunct(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{P}\p{S}]/u.test(ch);
}

function isCjk(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u.test(ch);
}

/** The plain-text projection of a label (image alt: no markup survives). */
function plainText(text: string): string {
  let out = '';
  for (const node of parseInline(text)) out += node.t === 'text' ? node.value : node.t === 'code' ? node.value : '';
  return out;
}

/**
 * The harness's protocol allowlist (`render.tsx`'s `sanitizeUrl`): only
 * `http`, `https` and `mailto` survive; relative, fragment and unparsable
 * destinations are dropped, which renders them as literal text.
 */
export function sanitizeUrl(url: string): string {
  try {
    switch (new URL(url).protocol) {
      case 'http:':
      case 'https:':
      case 'mailto:':
        return url;
      default:
        return '';
    }
  } catch {
    return '';
  }
}

/** Absolute HTTP(S) or nothing — image destinations get the stricter rule. */
export function remoteImageUrl(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** An inline-code token that is exactly an absolute HTTP(S) URL. */
export function inlineCodeHttpUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined;
  return remoteImageUrl(value);
}

/**
 * Percent-encode what a browser would refuse to read as a URL, keeping
 * already-encoded sequences intact (the harness normalizes through
 * micromark's sanitizer before its allowlist; this is the same normalized
 * shape for the destinations that reach it).
 */
export function normalizeUri(url: string): string {
  let out = '';
  for (let i = 0; i < url.length; i += 1) {
    const ch = url[i] ?? '';
    if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(url.slice(i + 1, i + 3))) {
      out += url.slice(i, i + 3);
      i += 2;
      continue;
    }
    out += /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?#[\]]$/.test(ch) ? ch : encodeURIComponent(ch);
  }
  return out;
}