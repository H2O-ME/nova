/**
 * Mention display tokens (`mention-tokens.ts`) — one rule shared by the
 * transcript chip and the composer mirror.
 *
 * The contract: the projection is LOSSLESS (the segments concatenate back to
 * the exact input, so nothing a user typed can disappear from the screen) and
 * it names only real mentions (an email address is prose, a stray `@` is the
 * trigger itself).
 */
import { describe, expect, it } from 'vitest';
import { mentionSegments } from '../src/mention-tokens.js';

/** The whole text, read back through the projection. */
function reconstruct(text: string): string {
  return mentionSegments(text)
    .map((segment) => (segment.kind === 'text' ? segment.text : segment.raw))
    .join('');
}

describe('mentionSegments', () => {
  it('leaves prose alone', () => {
    expect(mentionSegments('看下这个文件')).toEqual([{ kind: 'text', text: '看下这个文件' }]);
  });

  it('dresses a bare mention as a file chip, showing the last segment', () => {
    const segments = mentionSegments('读 @src/main.ts 再说话');
    expect(segments).toEqual([
      { kind: 'text', text: '读 ' },
      { kind: 'file', raw: '@src/main.ts', path: 'src/main.ts', label: 'main.ts' },
      { kind: 'text', text: ' 再说话' },
    ]);
  });

  it('keeps a quoted mention as one token across its spaces', () => {
    const [chip] = mentionSegments('@"我的 报告.md"').slice(0, 1);
    expect(chip).toEqual({ kind: 'file', raw: '@"我的 报告.md"', path: '我的 报告.md', label: '我的 报告.md' });
  });

  it('a directory token is a folder chip', () => {
    const [chip] = mentionSegments('@src/deep/').slice(0, 1);
    expect(chip).toMatchObject({ kind: 'folder', path: 'src/deep/', label: 'deep' });
  });

  it('a bare token stops at CJK punctuation, so glued prose is not eaten', () => {
    // Chinese runs without spaces: `@a.ts，然后看` must not become one token.
    const segments = mentionSegments('看 @src/main.ts，然后说话');
    expect(segments[1]).toMatchObject({ kind: 'file', path: 'src/main.ts', raw: '@src/main.ts' });
    expect(segments[2]).toEqual({ kind: 'text', text: '，然后说话' });
    // Inside a quoted mention the same character IS part of the path.
    expect(mentionSegments('@"带，逗号的文件.md"')[0]).toMatchObject({ kind: 'file', path: '带，逗号的文件.md' });
  });

  it('sheds sentence punctuation from a bare token, and keeps it on screen', () => {
    const segments = mentionSegments('见 @src/x.ts。');
    expect(segments[1]).toMatchObject({ kind: 'file', path: 'src/x.ts', raw: '@src/x.ts' });
    expect(reconstruct('见 @src/x.ts。')).toBe('见 @src/x.ts。');
  });

  it('an email address is prose, and a bare @ is just the trigger', () => {
    expect(mentionSegments('mail me at a@b.com')).toEqual([{ kind: 'text', text: 'mail me at a@b.com' }]);
    expect(mentionSegments('@')).toEqual([{ kind: 'text', text: '@' }]);
  });

  it('covers the whole text, whatever it holds', () => {
    for (const text of ['', 'plain', '@a @b/c.txt ', '@"x y" tail @z.', '中文 @路径/文件.ts 混排']) {
      expect(reconstruct(text)).toBe(text);
    }
  });
});
