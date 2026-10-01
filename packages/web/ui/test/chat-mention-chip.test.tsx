/**
 * References in a sent bubble (`mention-tokens.ts` + `UserMessageRow`).
 *
 * The logged text stays the truth; the bubble is its display projection, so a
 * mention that reached the log as ordinary text reads as a chip. Static markup
 * only (this lane has no DOM) — the assertions are about the chip hooks a
 * stylesheet and a ported layout depend on, not about exact wording.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UserMessageRow } from '../src/chat/MessageItem.js';

describe('user bubble references', () => {
  it('dresses a mention as a chip showing the last path segment', () => {
    const html = renderToStaticMarkup(createElement(UserMessageRow, { text: '读 @src/main.ts，然后说' }));
    expect(html).toContain('data-ref-chip="file"');
    expect(html).toContain('title="@src/main.ts"');
    // The chip shows the file name, not the whole path.
    expect(html).toContain('main.ts</span>');
    // The prose around it is untouched, punctuation included.
    expect(html).toContain('然后说');
  });

  it('a directory mention is a folder chip', () => {
    const html = renderToStaticMarkup(createElement(UserMessageRow, { text: '看 @packages/web/' }));
    expect(html).toContain('data-ref-chip="folder"');
  });

  it('plain prose renders verbatim', () => {
    const html = renderToStaticMarkup(createElement(UserMessageRow, { text: '没有引用' }));
    expect(html).not.toContain('data-ref-chip');
    expect(html).toContain('没有引用');
  });
});
