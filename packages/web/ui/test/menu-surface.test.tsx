/**
 * The two shell primitives this surface's overlays are built from, asserted
 * without a DOM (a server-render pass, plus the shipped stylesheet text, like
 * the other component lanes here).
 *
 * What is pinned, and why each one is a contract rather than a shape:
 *  - **the menu material is one layer**. The fill is translucent and carries a
 *    `backdrop-filter`; declaring that on the card itself would make the card a
 *    backdrop root and a containing block for the `position: fixed` placement
 *    the caller supplies, and the card would then be positioned against itself
 *    instead of the viewport. So the card must stay material-free and a
 *    dedicated child must carry the fill.
 *  - **the material keeps its token pair**. The reference's own guard rejects a
 *    menu fill that is not paired with the shared backdrop filter, and rejects
 *    any package sheet that redeclares either token — the theme owns both.
 *  - **the card keeps the caller's placement class**. `MenuSurface` adds
 *    geometry, never position: both cards here are `position: fixed` and are
 *    placed from a trigger rect.
 *  - **a tooltip never invents a bubble for a pointer**, and its anchor is
 *    named by `aria-describedby` only while the bubble is actually up —
 *    pointing a reader at an element that is not rendered is worse than the
 *    `title` attribute this replaced.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MenuSurface } from '../src/shell/MenuSurface.js';
import { Tooltip } from '../src/shell/Tooltip.js';

const surface = (props: Partial<Parameters<typeof MenuSurface>[0]> = {}): string =>
  renderToStaticMarkup(<MenuSurface {...props}>row</MenuSurface>);

/** A shipped stylesheet's text, comments stripped (a ported name is prose). */
const sheet = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/shell/${name}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

describe('MenuSurface', () => {
  it('carries the theme menu-material marker and a dedicated fill layer', () => {
    const html = surface();
    // The theme keys its dark-menu stroke rebind off this attribute
    // (gradient-shadow-text.css).
    expect(html).toContain('data-menu-material="translucent"');
    // The material is a child painted behind the content, never the card's own
    // background, so the card is never a backdrop root for the fixed position
    // its consumer applies.
    expect(html).toContain('aria-hidden="true"');
  });

  it('pairs the shared menu fill with the shared backdrop filter', () => {
    const css = sheet('MenuSurface.module.css');
    // The reference's elevation guard: a rule that paints either menu fill must
    // also apply the shared filter, since a translucent fill without the blur
    // lets the page show through unreadably.
    expect(css).toContain('background: var(--dsw-menu-surface-fill)');
    expect(css).toContain('backdrop-filter: var(--dsw-menu-backdrop-filter)');
  });

  it('leaves menu-fill ownership with the theme', () => {
    // Neither token may be re-declared outside `src/styles/`: a local override
    // would silently fork every menu's material from the theme's.
    for (const name of ['MenuSurface.module.css', 'Menu.module.css', 'MenuCard.module.css', 'Tooltip.module.css']) {
      const css = sheet(name);
      expect(css, name).not.toMatch(/--dsw-(?:specific-menu|menu-surface-fill|menu-backdrop-filter)\s*:/);
    }
  });

  it('renders the content beside the material layer', () => {
    expect(surface()).toContain('row');
  });

  it('adds the caller class without dropping its own geometry class', () => {
    const html = surface({ className: 'card' });
    // The consumer's placement (`position: fixed`) therefore wins over the
    // fallback without either sheet reaching for `!important`.
    expect(html).toMatch(/class="[^"]*card[^"]*"/);
    expect(html.split('class="')[1]?.split('"')[0]?.trim().split(/\s+/).length).toBe(2);
  });

  it('forwards the rest of the div contract to the card', () => {
    const html = surface({ role: 'menu', 'aria-label': '选择模型' });
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="选择模型"');
  });
});

describe('menu row rhythm', () => {
  it('sets both dropdowns to the reference row metrics', () => {
    // The reference's Menu `.item` and ModelSelect `.option` are one cell:
    // 34px min-height, R12 corners, 13px label. Two sheets here dress menus —
    // the shell primitive and the card family — and a drift between them
    // reads as two kinds of control in the same dock.
    for (const name of ['Menu.module.css', 'MenuCard.module.css']) {
      const css = sheet(name);
      expect(css, name).toContain('min-height: 34px');
      expect(css, name).toContain('border-radius: var(--dsw-radius-md)');
      expect(css, name).toContain('font-size: 13px');
    }
  });

  it('draws the menu asset at the reference size', () => {
    // The shared icon set emits a 16px box (style-guard requires the design box
    // on the element). A menu row's asset is 14px, and the sheet — not the
    // callsite — is where that step down belongs.
    for (const name of ['Menu.module.css', 'MenuCard.module.css']) {
      const css = sheet(name);
      expect(css, name).toMatch(/\.check svg[\s\S]{0,80}width: 14px/);
    }
  });
});

describe('Tooltip', () => {
  it('renders the anchor untouched while nothing is showing', () => {
    const html = renderToStaticMarkup(
      <Tooltip label="工具名"><button type="button">执行</button></Tooltip>,
    );
    // No bubble and no dangling description: a closed tooltip must be inert.
    expect(html).toBe('<button type="button">执行</button>');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('aria-describedby');
  });

  it('keeps the anchor rendered identically when disabled', () => {
    const plain = renderToStaticMarkup(
      <Tooltip label="工具名"><button type="button">执行</button></Tooltip>,
    );
    const off = renderToStaticMarkup(
      <Tooltip label="工具名" disabled><button type="button">执行</button></Tooltip>,
    );
    // Toggling `disabled` must never remount the anchor: a remount cuts its own
    // CSS transitions, and this is the state an answer flips.
    expect(off).toBe(plain);
  });

  it('preserves the anchor props it did not have to add', () => {
    const html = renderToStaticMarkup(
      <Tooltip label="工具名">
        <button type="button" className="badge" disabled>写入</button>
      </Tooltip>,
    );
    expect(html).toContain('class="badge"');
    expect(html).toContain('disabled');
  });

  it('animates the bubble on the shared curve and drops it under reduced motion', () => {
    const css = sheet('Tooltip.module.css');
    // 150ms in / out, the stack's curve — the same entry the reference uses.
    expect(css).toContain('animation: tooltip-in 150ms var(--ds-ease-in-out)');
    // A bubble that fades is decoration; the reduced-motion reader gets it
    // instantly rather than not at all.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  });
});
