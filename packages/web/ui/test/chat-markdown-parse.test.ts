/**
 * The markdown BLOCK grammar (`chat/markdown/parse.ts`). The lane asserts the
 * block vocabulary the ported typography sheet hangs off — fence languages,
 * list looseness and nesting, task items, table alignment and cell splitting —
 * instead of screenshotting a rendered paragraph.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown, splitRow } from '../src/chat/markdown/parse.js';
import type { MdBlock } from '../src/chat/markdown/parse.js';

const kinds = (blocks: MdBlock[]): string[] => blocks.map((block) => block.t);

describe('fenced code', () => {
  it('reads the info string as the grammar id and keeps the body verbatim', () => {
    expect(parseMarkdown('```ts\nconst a = 1;\n```')).toEqual([
      { t: 'code', lang: 'ts', code: 'const a = 1;' },
    ]);
  });

  it('truncates the info string at the first non-word character', () => {
    expect(parseMarkdown('```ts title="x"\nbody\n```')[0]).toEqual({ t: 'code', lang: 'ts', code: 'body' });
    expect(parseMarkdown('```\nbody\n```')[0]).toEqual({ t: 'code', lang: undefined, code: 'body' });
  });

  it('treats an unterminated fence as code through EOF (the streaming case)', () => {
    expect(parseMarkdown('```js\nlet x = 1;\nlet y')).toEqual([
      { t: 'code', lang: 'js', code: 'let x = 1;\nlet y' },
    ]);
  });

  it('accepts tilde fences and a four-backtick fence that contains three', () => {
    expect(parseMarkdown('~~~sh\necho hi\n~~~')[0]).toEqual({ t: 'code', lang: 'sh', code: 'echo hi' });
    expect(parseMarkdown('````\n```\ninner\n```\n````')[0]).toEqual({ t: 'code', lang: undefined, code: '```\ninner\n```' });
  });

  it('lets a fence interrupt a paragraph (CommonMark: not a paragraph line)', () => {
    // The reference grammar (mdast) reads the same shape: a paragraph, then a
    // fenced block — hence a separate `code` block here rather than prose.
    expect(kinds(parseMarkdown('text\n```\nx\n```'))).toEqual(['p', 'code']);
  });
});

describe('headings and breaks', () => {
  it('splits ATX levels and strips the closing hashes', () => {
    expect(parseMarkdown('# a')).toEqual([{ t: 'h', level: 1, text: 'a' }]);
    expect(parseMarkdown('###### f ##')).toEqual([{ t: 'h', level: 6, text: 'f' }]);
  });

  it('leaves a tag-like line as prose', () => {
    expect(kinds(parseMarkdown('#nope'))).toEqual(['p']);
  });

  it('reads thematic breaks in all three markers', () => {
    expect(kinds(parseMarkdown('---'))).toEqual(['hr']);
    expect(kinds(parseMarkdown('* * *'))).toEqual(['hr']);
    expect(kinds(parseMarkdown('____'))).toEqual(['hr']);
  });
});

describe('blockquote', () => {
  it('strips one quote level and parses its body as blocks', () => {
    expect(parseMarkdown('> # t\n> body')).toEqual([
      { t: 'quote', children: [{ t: 'h', level: 1, text: 't' }, { t: 'p', lines: ['body'] }] },
    ]);
  });

  it('keeps a nested quote a quote', () => {
    const [quote] = parseMarkdown('>> deep');
    expect(quote).toEqual({ t: 'quote', children: [{ t: 'quote', children: [{ t: 'p', lines: ['deep'] }] }] });
  });
});

describe('lists', () => {
  it('reads an unordered list with one paragraph per item', () => {
    expect(parseMarkdown('- a\n- b')).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        loose: false,
        items: [
          { children: [{ t: 'p', lines: ['a'] }] },
          { children: [{ t: 'p', lines: ['b'] }] },
        ],
      },
    ]);
  });

  it('carries an ordered list start and its own marker style', () => {
    const [list] = parseMarkdown('3) three\n4) four');
    expect(list).toMatchObject({ t: 'list', ordered: true, start: 3, loose: false });
  });

  it('nests a deeper list inside its item', () => {
    const [list] = parseMarkdown('- a\n  - b');
    expect(list).toMatchObject({ t: 'list', items: [{ children: [{ t: 'p', lines: ['a'] }, { t: 'list' }] }] });
  });

  it('marks a list loose when a blank line separates its items', () => {
    const [list] = parseMarkdown('- a\n\n- b');
    expect(list).toMatchObject({ t: 'list', loose: true });
  });

  it('reads GFM task markers off the item', () => {
    const [list] = parseMarkdown('- [x] done\n- [ ] todo');
    expect(list).toMatchObject({
      items: [
        { checked: true, children: [{ t: 'p', lines: ['done'] }] },
        { checked: false, children: [{ t: 'p', lines: ['todo'] }] },
      ],
    });
  });

  it('keeps a nested fence inside an item at its own indent', () => {
    const [list] = parseMarkdown('- step\n  ```sh\n  ls\n  ```');
    expect(list).toMatchObject({ items: [{ children: [{ t: 'p', lines: ['step'] }, { t: 'code', lang: 'sh', code: 'ls' }] }] });
  });
});

describe('tables', () => {
  it('reads alignment off the delimiter row', () => {
    expect(parseMarkdown('| a | b | c |\n| :-- | --: | :-: |\n| 1 | 2 | 3 |')).toEqual([
      {
        t: 'table',
        align: ['left', 'right', 'center'],
        head: ['a', 'b', 'c'],
        rows: [['1', '2', '3']],
      },
    ]);
  });

  it('keeps a body line without a pipe out of the table (GFM ends it there)', () => {
    const [table, after] = parseMarkdown('a | b\n- | -\n| 1 |\nplain');
    expect(table).toMatchObject({ t: 'table', rows: [['1']] });
    expect(after).toEqual({ t: 'p', lines: ['plain'] });
  });

  it('rejects a delimiter row whose cell count disagrees with the header', () => {
    expect(kinds(parseMarkdown('a | b\n- | - | -\n1 | 2 | 3'))).not.toContain('table');
  });

  it('does not read a paragraph before a dash row as a table', () => {
    expect(kinds(parseMarkdown('just text\n---'))).toEqual(['p', 'hr']);
  });
});

describe('splitRow', () => {
  it('drops outer pipes, trims cells and honors the escaped pipe', () => {
    expect(splitRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitRow('a|b')).toEqual(['a', 'b']);
    expect(splitRow('a \\| b | c')).toEqual(['a | b', 'c']);
    expect(splitRow('| |')).toEqual(['']);
  });
});

describe('paragraphs', () => {
  it('keeps the source lines of a wrapped paragraph (newlines collapse in the DOM)', () => {
    expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
      { t: 'p', lines: ['one', 'two'] },
      { t: 'p', lines: ['three'] },
    ]);
  });

  it('ends a paragraph at the next block start', () => {
    expect(parseMarkdown('text\n> quote')).toEqual([
      { t: 'p', lines: ['text'] },
      { t: 'quote', children: [{ t: 'p', lines: ['quote'] }] },
    ]);
  });
});