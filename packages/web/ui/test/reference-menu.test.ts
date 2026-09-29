/**
 * The `@` reference grammar. These rules decide two things a reader notices
 * immediately: whether the menu opens at all, and what text a pick leaves in
 * the draft. Both are pure, so they are asserted here rather than through a DOM.
 */
import { describe, expect, it } from 'vitest';
import { atQuery, atSpan, formatMention, referenceDraft, referenceItems } from '../src/composer/reference-menu.js';
import type { WireFileEntry } from '../src/types.js';

describe('atQuery', () => {
  it('reads the run after an @ that starts a token', () => {
    expect(atQuery('@')).toBe('');
    expect(atQuery('@src')).toBe('src');
    expect(atQuery('look at @src/main.ts')).toBe('src/main.ts');
    expect(atQuery('@a @b')).toBe('b');
  });

  it('does not open inside a word (an email address is prose)', () => {
    expect(atQuery('mail me at foo@bar.com')).toBeNull();
    expect(atQuery('foo@')).toBeNull();
  });

  it('closes once the reference is finished by a space', () => {
    // `@src/main.ts and then` is one token plus prose: filtering on the whole
    // sentence would list nothing, so the menu stands down instead.
    expect(atQuery('@src/main.ts and then')).toBeNull();
    expect(atQuery('@main.ts\nsecond line')).toBeNull();
  });

  it('keeps a quoted path as one token across its spaces', () => {
    expect(atQuery('@"my file')).toBe('my file');
    expect(atQuery('see @"a b/c')).toBe('a b/c');
  });

  it('has no query without an @', () => {
    expect(atQuery('just prose')).toBeNull();
    expect(atQuery('')).toBeNull();
  });
});

describe('formatMention', () => {
  it('writes a bare token for an unbroken path', () => {
    expect(formatMention('src/main.ts')).toBe('@src/main.ts');
    expect(formatMention('README.md')).toBe('@README.md');
  });

  it('quotes a path carrying whitespace so it stays one token', () => {
    expect(formatMention('my file.txt')).toBe('@"my file.txt"');
    expect(formatMention('a b/c d.ts')).toBe('@"a b/c d.ts"');
  });

  it('refuses a path the grammar cannot represent rather than writing a wrong one', () => {
    // A `"` cannot be escaped in this grammar, and stripping it would name a
    // DIFFERENT file: `@"weird.txt"` parses back as `weird.txt`, so the model
    // would read the wrong one. The reference refuses the same inputs
    // (`file-reference/grammar.ts`), and a refusal leaves the draft untouched.
    expect(formatMention('we"ird.txt')).toBeNull();
    expect(formatMention('a\u0000b.txt')).toBeNull();
    expect(referenceDraft('@x', 'we"ird.txt')).toBe('@x');
  });
});

describe('caret-relative detection', () => {
  it('closes an `@` token when the caret has left it', () => {
    // The token must END at the caret: a caret moved back into prose is not
    // editing a mention, so the menu closes instead of filtering on it.
    expect(atQuery('@src/main.ts tail', 12)).toBe('src/main.ts');
    expect(atQuery('@src/main.ts tail', 17)).toBeNull();
    // A caret moved back INSIDE the token narrows the query.
    expect(atQuery('@src/main.ts', 5)).toBe('src/');
  });

  it('reads a quoted token across its spaces and only up to the caret', () => {
    expect(atQuery('see @"a b/c d', 11)).toBe('a b/c');
    expect(atQuery('see @"a b/c d', 8)).toBe('a ');
  });
});

describe('atSpan', () => {
  it('names the span a pick replaces, quoted or bare', () => {
    expect(atSpan('look at @src/ma')).toEqual({ start: 8, end: 15, query: 'src/ma' });
    expect(atSpan('see @"a b')).toEqual({ start: 4, end: 9, query: 'a b' });
  });

  it('is null when no reference is live', () => {
    expect(atSpan('plain prose')).toBeNull();
    expect(atSpan('foo@bar.com')).toBeNull();
  });
});

describe('caret-relative picks', () => {
  it('rewrites the token the caret is in, leaving the rest of the draft alone', () => {
    // A pick mid-draft must not truncate what follows the token.
    expect(referenceDraft('@sr and then more', 'src/main.ts', false, 3)).toBe('@src/main.ts  and then more');
    // A caret that has left the token entirely is not editing it: the draft is
    // returned untouched rather than rewritten around a stale mention.
    expect(referenceDraft('@sr and then more', 'src/main.ts')).toBe('@sr and then more');
  });
});
describe('referenceDraft', () => {
  it('replaces the active token with the mention and a trailing space', () => {
    expect(referenceDraft('@src', 'src/main.ts')).toBe('@src/main.ts ');
    expect(referenceDraft('look at @src/ma', 'src/main.ts')).toBe('look at @src/main.ts ');
  });

  it('quotes a path with spaces as one token', () => {
    expect(referenceDraft('@my', 'my file.txt')).toBe('@"my file.txt" ');
  });

  it('appends a slash for a directory pick and leaves the token LIVE', () => {
    // The regression this pins: the pick wrote `@src/ ` — slash AND a trailing
    // space — which terminated the token, so `atQuery` returned null on the very
    // next keystroke and the menu could never descend another level. A directory
    // pick must stay live: no trailing space, so the caret sits inside the token
    // and completion continues.
    expect(referenceDraft('@sr', 'src', true)).toBe('@src/');
    expect(atQuery(referenceDraft('@sr', 'src', true))).toBe('src/');
    // A file pick is finished business: it closes the token with a space.
    expect(referenceDraft('@sr', 'src/main.ts', false)).toBe('@src/main.ts ');
  });

  it('keeps a quoted directory token open so descent survives whitespace', () => {
    // Same rule where the quote matters most: the harness leaves the quote
    // unterminated (`@"my dir/`) precisely so the token stays parseable.
    expect(referenceDraft('@my', 'my dir', true)).toBe('@"my dir/');
    expect(atQuery(referenceDraft('@my', 'my dir', true))).toBe('my dir/');
    // A quoted FILE still closes, and still takes its trailing space.
    expect(referenceDraft('@my', 'my dir/a.ts', false)).toBe('@"my dir/a.ts" ');
  });

  it('leaves a draft with no @ untouched', () => {
    expect(referenceDraft('plain prose', 'src/main.ts')).toBe('plain prose');
  });
});

describe('referenceItems', () => {
  const entries: readonly WireFileEntry[] = [
    { path: 'src', name: 'src', kind: 'directory' },
    { path: 'src/main.ts', name: 'main.ts', kind: 'file' },
    { path: 'README.md', name: 'README.md', kind: 'file' },
  ];

  it('lists files before directories', () => {
    expect(referenceItems(entries).map((item) => item.id)).toEqual(['src/main.ts', 'README.md', 'src']);
  });

  it('names the parent directory as the disambiguator, and omits it at the root', () => {
    const items = referenceItems(entries);
    expect(items.find((item) => item.id === 'src/main.ts')?.description).toBe('src');
    // A root entry has no parent to name, and repeating its label says nothing.
    expect(items.find((item) => item.id === 'README.md')?.description).toBeUndefined();
  });

  it('marks a directory as drillable and labels it with a trailing slash', () => {
    const dir = referenceItems(entries).find((item) => item.id === 'src');
    expect(dir?.drill).toBe(true);
    expect(dir?.label).toBe('src/');
  });
});
