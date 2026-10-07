/**
 * The plugin center's PLACEMENT: it is a main-column page reached from the
 * sidebar's own entry, not a section inside the settings dialog.
 *
 * The reference (`ui-plugin-manager`) contributes the sidebar's Plugins panel
 * and gives it the main column; Nova shipped the same roster as a settings
 * section, which put it two clicks deep behind 设置. These assertions pin the
 * two halves of that placement — the page draws the roster, and the sidebar row
 * states whether it is the current page.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PluginCenterPage } from '../src/settings/PluginCenterPage.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';
import { PluginsEntryButton } from '../src/sidebar/PluginsEntryButton.js';
import { SIDEBAR_COPY } from '../src/sidebar/view.js';

const page = (roster: Parameters<typeof PluginCenterPage>[0]['roster']): string =>
  renderToStaticMarkup(
    <PluginCenterPage
      roster={roster}
      plugins={null}
      disabled={false}
      manageError={null}
      send={() => undefined}
    />,
  );

describe('PluginCenterPage', () => {
  it('draws the kernel roster, with each row reading its own description', () => {
    const html = page({
      entries: [
        {
          name: 'fs',
          state: 'active',
          inject: [],
          title: '文件读写',
          description: '读写工作区文件。',
        },
      ],
      configPath: 'C:\\cfg.json',
    });
    expect(html).toContain('data-plugin-center');
    expect(html).toContain(SETTINGS_COPY['plugins.title']);
    expect(html).toContain('文件读写');
    expect(html).toContain('读写工作区文件。');
  });

  it('says it is still reading rather than drawing an empty roster', () => {
    expect(page(null)).toContain(SETTINGS_COPY['plugins.loading']);
  });
});

describe('PluginsEntryButton', () => {
  it('names itself the current page only while the center is open', () => {
    const open = renderToStaticMarkup(<PluginsEntryButton wide active onOpen={() => undefined} />);
    expect(open).toContain('aria-current="page"');
    expect(open).toContain(SIDEBAR_COPY['plugins.entry']);
    const closed = renderToStaticMarkup(<PluginsEntryButton wide active={false} onOpen={() => undefined} />);
    expect(closed).not.toContain('aria-current');
  });

  it('drops the visible label in the rail, keeping the accessible one', () => {
    const rail = renderToStaticMarkup(<PluginsEntryButton wide={false} active={false} onOpen={() => undefined} />);
    expect(rail).not.toContain(`>${SIDEBAR_COPY['plugins.entry']}</span>`);
    expect(rail).toContain(`aria-label="${SIDEBAR_COPY['plugins.entry']}"`);
  });
});
