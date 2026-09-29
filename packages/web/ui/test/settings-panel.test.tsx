/**
 * A server-render pass over the settings modal: no DOM, no browser —
 * `renderToStaticMarkup` walks the real JSX with real props. The behavior
 * lanes (mask click, Escape ownership, focus restore) live in the browser by
 * design; what a static pass pins is the chrome the reference defines: the
 * dialog's name and nav row, the appearance cubes' pressed state, and the
 * stepper's bounds as disabled arrows.
 */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsDialog } from '../src/settings/SettingsPanel.js';
import { AppearanceRow } from '../src/settings/AppearanceRow.js';
import { FontSizeRow } from '../src/settings/FontSizeRow.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';
import { SettingsIcon } from '../src/icons.js';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../src/theme.js';

function panel(): string {
  return renderToStaticMarkup(
    <SettingsDialog
      title="设置"
      closeLabel={SETTINGS_COPY['settings.close']}
      onClose={() => undefined}
      onSelect={() => undefined}
      sections={[{
        id: 'general',
        label: SETTINGS_COPY['general.nav'],
        icon: <SettingsIcon />,
        content: (
          <>
            <AppearanceRow preference="dark" onPick={() => undefined} />
            <FontSizeRow fontSize={14} onPick={() => undefined} />
          </>
        ),
      }]}
    />,
  );
}

describe('settings panel', () => {
  it('renders the dialog with its name, nav row and close label', () => {
    const html = panel();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('>设置</div>');
    expect(html).toContain(SETTINGS_COPY['general.nav']);
    expect(html).toContain('aria-current="true"');
    // The close control's accessible name rides a visually-hidden span.
    expect(html).toContain(`>${SETTINGS_COPY['settings.close']}</span>`);
  });

  it('marks the active section and no other', () => {
    const html = renderToStaticMarkup(
      <SettingsDialog
        title="设置"
        closeLabel="关闭"
        onClose={() => undefined}
        onSelect={() => undefined}
        sections={[
          { id: 'a', label: '甲', icon: <SettingsIcon />, content: <div /> },
          { id: 'b', label: '乙', icon: <SettingsIcon />, content: <div /> },
        ]}
      />,
    );
    // The projection falls back to the first row when no id was requested.
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    const cells = html.split('<button');
    expect(cells[1]).toContain('aria-current="true"');
    expect(cells[1]).toContain('>甲</span>');
    expect(cells[2]).toContain('>乙</span>');
  });

  it('rides the close control on the actions seat so it lands top-right', () => {
    // The defect this pins: `.header` is `justify-content: space-between`, so a
    // close button that is the header's ONLY child sits at the START edge (the
    // left). What puts it top-right is the actions seat's `margin-left: auto`
    // — so the seat must both exist in the markup and carry that rule. Neither
    // half alone is sufficient, and a static pass is the only lane that can
    // see the pairing (the position assertions live in the browser).
    const html = panel();
    const start = html.indexOf('_header_');
    expect(start).toBeGreaterThan(-1);
    const header = html.slice(start, html.indexOf(SETTINGS_COPY['settings.close'], start));
    // The seat precedes the control: a lone button in a `space-between` header
    // is what puts it at the left edge.
    expect(header).toContain('_actions_');
    expect(header.indexOf('_actions_')).toBeLessThan(header.indexOf('_close_'));
    expect(header.indexOf('<button')).toBeGreaterThan(header.indexOf('_actions_'));

    const css = readFileSync(
      new URL('../src/settings/SettingsPanel.module.css', import.meta.url),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(css).toContain('.actions {');
    expect(css).toContain('margin-left: auto');
  });
});

describe('appearance row', () => {
  it('renders three cubes with the pressed state on the preference', () => {
    const html = renderToStaticMarkup(
      <AppearanceRow preference="system" onPick={() => undefined} />,
    );
    expect(html).toContain(SETTINGS_COPY['appearance.title']);
    expect(html).toContain(SETTINGS_COPY['appearance.light']);
    expect(html).toContain(SETTINGS_COPY['appearance.dark']);
    expect(html).toContain(SETTINGS_COPY['appearance.system']);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    // Selection follows the persisted preference, not cube order.
    const cubes = html.split('<button');
    expect(cubes[3]).toContain('aria-pressed="true"');
  });
});

describe('font size row', () => {
  it('renders title, description, value and unit', () => {
    const html = renderToStaticMarkup(
      <FontSizeRow fontSize={14} onPick={() => undefined} />,
    );
    expect(html).toContain(SETTINGS_COPY['fontSize.title']);
    expect(html).toContain(SETTINGS_COPY['fontSize.description']);
    expect(html).toContain('<span class');
    expect(html).toContain('>14</span>');
    expect(html).toContain(`>${SETTINGS_COPY['fontSize.unit']}</span>`);
  });

  it('disables the arrows at the axis bounds and enables them inside', () => {
    const atMax = renderToStaticMarkup(
      <FontSizeRow fontSize={FONT_SIZE_MAX} onPick={() => undefined} />,
    );
    expect(atMax).toContain('aria-label="增大字号" disabled');
    expect(atMax).not.toContain('aria-label="减小字号" disabled');

    const atMin = renderToStaticMarkup(
      <FontSizeRow fontSize={FONT_SIZE_MIN} onPick={() => undefined} />,
    );
    expect(atMin).toContain('aria-label="减小字号" disabled');
    expect(atMin).not.toContain('aria-label="增大字号" disabled');

    const mid = renderToStaticMarkup(
      <FontSizeRow fontSize={14} onPick={() => undefined} />,
    );
    expect(mid).toContain('aria-label="增大字号"');
    expect(mid).toContain('aria-label="减小字号"');
    expect(mid).not.toContain('disabled=""');
  });
});
