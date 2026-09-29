/**
 * The session row's markup and its title marquee, rendered statically with
 * real props. The marquee's motion is a frame loop the browser drives, so this
 * lane pins what it can be asked about without one: the shape the sheet reads
 * its hover-swap and fade-mask rules from, and the copy on the row's actions.
 */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionRow, ProjectRow } from '../src/sidebar/SessionRow.js';
import { relativeStamp } from '../src/sidebar/relative-time.js';
import { SIDEBAR_COPY } from '../src/sidebar/view.js';

const NOW = new Date(2026, 8, 21, 15, 0, 0).getTime();
const ITEM = { file: 'C:/nova/sessions/a.jsonl', title: '一次会话', mtime: NOW - 5 * 60_000 };

const row = (overrides: Partial<typeof ITEM> = {}): string =>
  renderToStaticMarkup(
    <SessionRow item={{ ...ITEM, ...overrides }} selected={false} now={NOW} onOpen={() => undefined} onDelete={() => undefined} />,
  );

describe('session row', () => {
  it('carries the identity the animation and the selection read', () => {
    const html = row();
    expect(html).toContain('role="treeitem"');
    expect(html).toContain('data-row-key="C:/nova/sessions/a.jsonl"');
    expect(html).toContain('aria-selected="false"');
  });

  it('marks the row the kernel is attached to', () => {
    const html = renderToStaticMarkup(
      <SessionRow item={ITEM} selected now={NOW} onOpen={() => undefined} onDelete={() => undefined} />,
    );
    expect(html).toContain('aria-selected="true"');
  });

  it('dates the row relatively, not with a wall clock', () => {
    const html = row();
    expect(html).toContain(relativeStamp(ITEM.mtime, NOW));
    // The old absolute stamp: the reference never prints one in a row.
    expect(html).not.toMatch(/\d{1,2}:\d{2}</);
  });

  it('falls back to the new-session word for a log with no prompt yet', () => {
    const html = row({ title: '' });
    expect(html).toContain(SIDEBAR_COPY['session.new']);
  });

  it('names the row it would delete, so the button is unambiguous by screen reader', () => {
    const html = row();
    expect(html).toContain(`删除会话：${ITEM.title}`);
    // The glyph-only button still needs a visible-name fallback for hover.
    expect(html).toContain('title="删除"');
  });

  it('pairs the hover swap and the marquee masks in the sheet', () => {
    // The row's own two rules that markup alone cannot show: the trailing cell
    // swap (dsh `Rows.tsx`: the actions occupy the timestamp's cell) and the
    // marquee's fade hooks. Both are the pairing of an attribute/selector in
    // the component with a rule in the sheet.
    const css = readFileSync(
      new URL('../src/sidebar/SessionRow.module.css', import.meta.url),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(css).toContain('.sessionRow:hover .rowActions');
    expect(css).toContain('.sessionRow:hover .time');
    expect(css).toContain('.sessionRow .title[data-scrolled]');
    expect(css).toContain('.sessionRow .title[data-clipped]');
  });
});

describe('project row', () => {
  it('renders the group label with its fold state', () => {
    const html = renderToStaticMarkup(
      <ProjectRow label="我的工作区" path="C:/work" rowKey="group:C:/work" expanded containsCurrent onToggle={() => undefined} />,
    );
    expect(html).toContain('我的工作区');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('title="C:/work"');
    expect(html).toContain('data-row-key="group:C:/work"');
  });

  it('renders the ungrouped bucket without a path tooltip', () => {
    const html = renderToStaticMarkup(
      <ProjectRow label="未分组" path={undefined} rowKey="group:" expanded={false} containsCurrent={false} onToggle={() => undefined} />,
    );
    expect(html).toContain('未分组');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('title=');
  });
});
