/**
 * The collapsed rail's controls.
 *
 * The rail is a 56px track of bare glyphs: no label is on screen anywhere, so
 * every control's name has to reach a reader who is not holding a pointer. A
 * native `title` does not — it never appears for a keyboard user — which is why
 * the reference wraps these seats in its Tooltip primitive. Rendered without a
 * DOM (`renderToStaticMarkup`), like the rest of this lane.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListHeader } from '../src/sidebar/ListHeader.js';
import { SIDEBAR_COPY } from '../src/sidebar/view.js';

const header = (rail: boolean): string =>
  renderToStaticMarkup(
    <ListHeader
      mode="workspace"
      onPickMode={() => {}}
      query=""
      onQuery={() => {}}
      searchOpen={false}
      onSearchOpen={() => {}}
      onReload={() => {}}
      rail={rail}
      onExpand={() => {}}
    />,
  );

describe('rail list header', () => {
  it('names both rail controls for a reader without a pointer', () => {
    // `aria-label` alone is announced but never shown: the visual reader who is
    // not hovering with a mouse still needs the label, and the tooltip is the
    // one channel that serves both.
    const html = header(true);
    const labels = [SIDEBAR_COPY['list.reload'], '搜索会话'];
    for (const label of labels) {
      const tags = html.match(/<button[^>]*>/g) ?? [];
      const anchor = tags.find((tag) => tag.includes(label));
      expect(anchor, `no rail button named ${label}`).toBeDefined();
    }
    expect(html).toContain('搜索会话');
    expect(html).toContain(SIDEBAR_COPY['list.reload']);
  });

  it('keeps the expanded header a labelled control row', () => {
    // The wide header reads from a visible section word and a real text field,
    // so it must not regress into the rail's glyph-only shape (the rail returns
    // no section label and no input at all).
    const html = header(false);
    expect(html).toContain('搜索会话');
    expect(html).toContain('<input');
    expect(html).not.toContain(SIDEBAR_COPY['list.loading']);
    expect(header(true)).not.toContain('<input');
  });
});
