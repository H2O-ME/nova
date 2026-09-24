/**
 * The markdown INLINE grammar (`chat/markdown/inline.ts`): emphasis and code
 * spans, the harness's CJK-friendly strong rule, hard breaks, and the
 * untrusted-destination policy (the allowlist that keeps `javascript:` and
 * relative URLs inert). The lane asserts tokens, not elements — the renderer
 * is a projection of exactly this tree, so a rule asserted here cannot drift
 * between the plain and the streaming arm.
 */
import { describe, expect, it } from 'vitest';
import {
  inlineCodeHttpUrl,
  normalizeUri,
  parseInline,
  remoteImageUrl,
  sanitizeUrl,
} from '../src/chat/markdown/inline.js';
import type { InlineNode } from '../src/chat/markdown/inline.js';

/** The plain text a node list contributes (what a reader would see). */
function text(nodes: readonly InlineNode[]): string {
  return nodes.map((node) => {
    switch (node.t) {
      case 'text': return node.value;
      case 'br': return '\n';
      case 'code': return node.value;
      case 'image': return node.alt;
      default: return text(node.children);
    }
  }).join('');
}

describe('code spans', () => {
  it('matches a run of backticks with an equal-length closer', () => {
    expect(parseInline('`a`')).toEqual([{ t: 'code', value: 'a' }]);
    expect(parseInline('``a ` b``')).toEqual([{ t: 'code', value: 'a ` b' }]);
  });

  it('turns line endings into spaces and strips one wrapping space pair', () => {
    expect(parseInline('`a\nb`')).toEqual([{ t: 'code', value: 'a b' }]);
    expect(parseInline('` a `')).toEqual([{ t: 'code', value: 'a' }]);
  });

  it('leaves an unmatched backtick as text', () => {
    expect(parseInline('a ` b')).toEqual([{ t: 'text', value: 'a ` b' }]);
  });

  it('never lets a later emphasis rule re-match inside a code span', () => {
    // The scanner consumes the span atomically (the bug the TUI renderer had
    // to paper over with placeholders).
    expect(parseInline('`a**b` **c**')).toEqual([
      { t: 'code', value: 'a**b' },
      { t: 'text', value: ' ' },
      { t: 'strong', children: [{ t: 'text', value: 'c' }] },
    ]);
  });

  it('promotes a token that IS an http(s) URL to a link, keeping its chrome', () => {
    expect(parseInline('`https://nova.dev/x`')).toEqual([
      { t: 'code', value: 'https://nova.dev/x', href: 'https://nova.dev/x' },
    ]);
    expect(parseInline('`npm run x`')).toEqual([{ t: 'code', value: 'npm run x' }]);
  });
});

describe('emphasis', () => {
  it('reads strong, em and strikethrough, with nesting', () => {
    expect(parseInline('**a**')).toEqual([{ t: 'strong', children: [{ t: 'text', value: 'a' }] }]);
    expect(parseInline('*a*')).toEqual([{ t: 'em', children: [{ t: 'text', value: 'a' }] }]);
    expect(parseInline('~~a~~')).toEqual([{ t: 'del', children: [{ t: 'text', value: 'a' }] }]);
    expect(parseInline('**a *b* c**')).toEqual([
      {
        t: 'strong',
        children: [
          { t: 'text', value: 'a ' },
          { t: 'em', children: [{ t: 'text', value: 'b' }] },
          { t: 'text', value: ' c' },
        ],
      },
    ]);
  });

  it('requires an unescaped closer: an odd marker stays literal', () => {
    expect(text(parseInline('a * b'))).toBe('a * b');
  });

  it('nests a three-marker run instead of leaving a delimiter as text', () => {
    // Reading only two of the three used to emit `*a*`: strong around a literal
    // asterisk. CommonMark nests one level per pair, em outermost when odd.
    expect(parseInline('***a***')).toEqual([
      { t: 'em', children: [{ t: 'strong', children: [{ t: 'text', value: 'a' }] }] },
    ]);
    expect(parseInline('****a****')).toEqual([
      { t: 'strong', children: [{ t: 'strong', children: [{ t: 'text', value: 'a' }] }] },
    ]);
    // An unclosed three-run still falls back to its two-marker read.
    expect(text(parseInline('***a**'))).toBe('*a');
  });

  it('closes strong after punctuation when CJK prose continues (the harness rule)', () => {
    // Without the extension the closing run is not right-flanking: the
    // character before it is punctuation and the one after it is a word.
    expect(parseInline('**注意：**接下来')).toEqual([
      { t: 'strong', children: [{ t: 'text', value: '注意：' }] },
      { t: 'text', value: '接下来' },
    ]);
  });

  it('keeps the CJK rule on the two-marker run only (em stays literal)', () => {
    expect(text(parseInline('*注意：*接下来'))).toBe('*注意：*接下来');
  });

  it('honors backslash escapes', () => {
    expect(parseInline('\\*not em\\*')).toEqual([{ t: 'text', value: '*not em*' }]);
  });
});

describe('links, autolinks and images', () => {
  it('keeps the allowlisted protocols and drops the rest as literal text', () => {
    expect(parseInline('[a](https://x.dev)')).toEqual([
      { t: 'link', href: 'https://x.dev', children: [{ t: 'text', value: 'a' }], glyph: true },
    ]);
    expect(text(parseInline('[a](javascript:alert(1))'))).toBe('[a](javascript:alert(1))');
    expect(text(parseInline('[a](/relative)'))).toBe('[a](/relative)');
    expect(parseInline('[a](mailto:x@y.dev)')[0]).toMatchObject({ t: 'link', href: 'mailto:x@y.dev' });
  });

  it('drops a quoted title from the destination', () => {
    expect(parseInline('[a](https://x.dev "t")')[0]).toMatchObject({ href: 'https://x.dev' });
  });

  it('skips the leading glyph when the anchor is only an image', () => {
    expect(parseInline('[![alt](https://x.dev/i.png)](https://x.dev)')[0]).toMatchObject({ t: 'link', glyph: false });
  });

  it('reads angle-bracket autolinks', () => {
    expect(parseInline('<https://x.dev>')[0]).toMatchObject({ t: 'link', href: 'https://x.dev' });
    expect(text(parseInline('<div>'))).toBe('<div>');
  });

  it('parses an image whatever its destination and reports displayability', () => {
    expect(parseInline('![alt](https://x.dev/i.png)')).toEqual([
      { t: 'image', url: 'https://x.dev/i.png', alt: 'alt', destination: 'https://x.dev/i.png' },
    ]);
    expect(parseInline('![alt](/local.png)')).toEqual([
      { t: 'image', url: undefined, alt: 'alt', destination: '/local.png' },
    ]);
    expect(parseInline('![alt](file:///x.png)')[0]).toMatchObject({ url: undefined });
  });
});

describe('breaks', () => {
  it('reads two trailing spaces and a backslash as a hard break', () => {
    expect(parseInline('a  \nb')).toEqual([{ t: 'text', value: 'a' }, { t: 'br' }, { t: 'text', value: 'b' }]);
    expect(parseInline('a\\\nb')).toEqual([{ t: 'text', value: 'a' }, { t: 'br' }, { t: 'text', value: 'b' }]);
  });

  it('keeps a soft break as a newline in the text run (CSS collapses it)', () => {
    expect(parseInline('a\nb')).toEqual([{ t: 'text', value: 'a\nb' }]);
  });
});

describe('destination policy', () => {
  it('allows http, https and mailto only', () => {
    expect(sanitizeUrl('https://x')).toBe('https://x');
    expect(sanitizeUrl('mailto:a@b')).toBe('mailto:a@b');
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('data:text/html,x')).toBe('');
    expect(sanitizeUrl('/rel')).toBe('');
    expect(sanitizeUrl('#frag')).toBe('');
  });

  it('requires an absolute http(s) URL for images and for promoted code', () => {
    expect(remoteImageUrl('https://x/i.png')).toBe('https://x/i.png');
    expect(remoteImageUrl('ftp://x/i.png')).toBeUndefined();
    expect(inlineCodeHttpUrl('https://x')).toBe('https://x');
    expect(inlineCodeHttpUrl(' https://x')).toBeUndefined();
  });

  it('percent-encodes what a browser would refuse and keeps existing escapes', () => {
    expect(normalizeUri('https://x/a b')).toBe('https://x/a%20b');
    expect(normalizeUri('https://x/a%20b')).toBe('https://x/a%20b');
  });
});