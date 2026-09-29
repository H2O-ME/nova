/**
 * The syntax-highlight scanner (`chat/markdown/highlight.ts`). Two contracts
 * are what make it safe inside a renderer: the run list is a LOSSLESS
 * projection of the source (so a highlighted fence and the plain one show the
 * same characters), and every kind it emits has a `--shiki-*` variable behind
 * it (the vendored sheet owns the colors). A language without a scanner must
 * return undefined, which is what routes the caller to the plain `<pre>` arm.
 */
import { describe, expect, it } from 'vitest';
import { TOKEN_VAR, highlightLines, supportsHighlighting } from '../src/chat/markdown/highlight.js';
import type { HlKind } from '../src/chat/markdown/highlight.js';

/** The source a run list represents back, line for line. */
function sourceOf(lines: readonly { text: string; kind: HlKind }[][]): string {
  return lines.map((line) => line.map((span) => span.text).join('')).join('\n');
}

/** Every kind present in the highlighted source. */
function kindsOf(source: string, lang: string): Set<HlKind> {
  const lines = highlightLines(source, lang);
  expect(lines).toBeDefined();
  return new Set((lines ?? []).flat().map((span) => span.kind));
}

describe('losslessness', () => {
  const samples: [string, string][] = [
    ['ts', 'const a = 1; // c\nfunction f() {\n  return `x${a}y`;\n}\n/* block\ncomment */\n'],
    ['bash', '#!/usr/bin/env bash\nset -e\nif [ -f "$HOME/x" ]; then\n  echo "hi # not comment"\nfi\n'],
    ['python', '# top\n@decorator\ndef f(x=1):\n    """doc"""\n    return {"a": None}\n'],
    ['json', '{\n  "a": [1, -2.5e3, true, null],\n  "b": "s"\n}\n'],
    ['yaml', 'key: value # c\nlist:\n  - "quoted"\n'],
  ];
  for (const [lang, source] of samples) {
    it(`round-trips ${lang} source exactly`, () => {
      const lines = highlightLines(source, lang);
      expect(lines).toBeDefined();
      expect(sourceOf(lines ?? [])).toBe(source);
    });
  }

  it('round-trips an empty fence and a trailing newline', () => {
    // An empty source is one empty line (nothing to paint); the caller's empty
    // fence arm never reaches the scanner.
    expect(sourceOf(highlightLines('', 'ts') ?? [])).toBe('');
    expect(sourceOf(highlightLines('a\n', 'ts') ?? [])).toBe('a\n');
  });
});

describe('token kinds', () => {
  it('classifies keywords, strings, comments and numbers in a c-like language', () => {
    const kinds = kindsOf('const s = "x"; // note', 'ts');
    expect(kinds).toContain('keyword');
    expect(kinds).toContain('string');
    expect(kinds).toContain('comment');
    expect(kindsOf('let n = 42;', 'js')).toContain('number');
  });

  it('marks a call site as a function and a shell variable as a parameter', () => {
    expect(kindsOf('run()', 'ts')).toContain('function');
    expect(kindsOf('echo "$HOME"', 'bash')).toContain('parameter');
    expect(kindsOf('echo ${HOME}', 'bash')).toContain('parameter');
  });

  it('keeps a line comment inside a string as string content', () => {
    const lines = highlightLines('x = "# nope";', 'python') ?? [];
    expect(lines[0]?.some((span) => span.kind === 'comment')).toBe(false);
  });

  it('reads python decorators and json constants', () => {
    expect(kindsOf('@app.route\n', 'python')).toContain('function');
    expect(kindsOf('{"a": true}', 'json')).toContain('constant');
  });
});

describe('grammar table', () => {
  it('returns undefined for an unknown language and for no language at all', () => {
    expect(highlightLines('x', undefined)).toBeUndefined();
    expect(highlightLines('x', 'brainfuck')).toBeUndefined();
    expect(highlightLines('x', 'markdown')).toBeUndefined();
  });

  // The table is an object literal, so a bare index would hand back an inherited
  // member: `constructor` resolves to a function and reaches the scanner as a
  // non-spec, throwing during render. Both entry points must refuse it, and the
  // fence info string reaches them straight from model output (parse.ts).
  it('refuses Object.prototype member names instead of scanning a non-spec', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(highlightLines('const a = 1;', name)).toBeUndefined();
      expect(supportsHighlighting(name)).toBe(false);
    }
  });

  it('agrees with the label test for every real grammar and a few impostors', () => {
    for (const name of [...Object.keys(TOKEN_VAR), 'ts', 'TS', ' ts', 'python', '', 'nope', 'constructor']) {
      expect(supportsHighlighting(name)).toBe(highlightLines('x', name) !== undefined);
    }
  });

  it('every emitted kind resolves to a shiki variable from the vendored sheet', () => {
    for (const [kind, variable] of Object.entries(TOKEN_VAR)) {
      expect(kind).not.toBe('plain');
      expect(variable.startsWith('var(--shiki-')).toBe(true);
    }
  });
});