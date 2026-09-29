/**
 * The collapsed sidebar rail, in the two states that used to look identical.
 *
 * The reported defect was "the sidebar just disappeared". Below
 * `SIDEBAR_AUTO_COLLAPSE` (1024px) the column is a 56px rail by DESIGN — the
 * frame's own rule, ported from the harness — so the defect is not that the rail
 * exists but that nothing said so. A reader whose window happened to be narrow
 * saw the same glyph as a reader who had closed the column themselves, and the
 * one control that brings it back named only what it does, never why the column
 * was gone.
 *
 * The rail's control therefore carries the REASON when the collapse was the
 * window's doing, and the frame marks the state (`data-sidebar-auto-collapsed`)
 * so the rail can carry it visually too. Both are asserted here, markup-only.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SidebarLogoRow } from '../src/sidebar/SidebarLogoRow.js';
import { SIDEBAR_COPY } from '../src/sidebar/view.js';

const rail = (autoCollapsed: boolean): string =>
  renderToStaticMarkup(
    <SidebarLogoRow
      wide={false}
      collapsed
      autoCollapsed={autoCollapsed}
      onToggleCollapsed={() => {}}
      onStartSession={() => {}}
    />,
  );

/** The toggle's own name, from the first `aria-label` in the rail. */
function toggleLabel(markup: string): string {
  return markup.match(/aria-label="([^"]+)"/)?.[1] ?? '';
}

describe('collapsed sidebar rail', () => {
  it('names an auto-collapse for what it is', () => {
    const markup = rail(true);
    expect(toggleLabel(markup)).toBe(SIDEBAR_COPY['toggle.openAuto']);
    // The reason has to be readable, not just announced: a reader who is not
    // hovering still needs to know the window did this, not they.
    expect(markup).toContain('窗口较窄');
    expect(markup).toContain('data-auto-collapsed');
  });

  it('keeps the plain wording when the reader closed the column', () => {
    const markup = rail(false);
    expect(toggleLabel(markup)).toBe(SIDEBAR_COPY['toggle.open']);
    expect(markup).not.toContain('窗口较窄');
    expect(markup).not.toContain('data-auto-collapsed');
  });

  it('keeps the expanded column a labelled control row', () => {
    const wide = renderToStaticMarkup(
      <SidebarLogoRow wide collapsed={false} onToggleCollapsed={() => {}} onStartSession={() => {}} />,
    );
    expect(wide).toContain(SIDEBAR_COPY['toggle.collapse']);
    expect(wide).toContain(SIDEBAR_COPY.brand);
  });
});
