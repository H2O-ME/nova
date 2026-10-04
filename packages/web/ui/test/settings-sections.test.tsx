/**
 * A server-render pass over the settings sections: no DOM, no browser —
 * `renderToStaticMarkup` walks the real JSX with real props. Pinned here: the
 * 通用设置 rows' copy and controls, the 模型 catalog's rows with the check on
 * the model in force, and the 内置插件 roster's rows with the config path's
 * copy control. Effects (the fetch-on-open asks) live in the browser by
 * design; the static lane pins what renders once the data is here.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GeneralSection } from '../src/settings/GeneralSection.js';
import { ModelSection } from '../src/settings/ModelSection.js';
import { PluginRow } from '../src/settings/PluginRow.js';
import { PluginsSection } from '../src/settings/PluginsSection.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';

const general = (): string =>
  renderToStaticMarkup(
    <GeneralSection
      approvalMode="read-only"
      preference="dark"
      fontSize={14}
      disabled={false}
      transcriptView="standard"
      onPickApproval={() => undefined}
      onPickPreference={() => undefined}
      onPickFontSize={() => undefined}
      onPickTranscriptView={() => undefined}
    />,
  );

describe('general section', () => {
  it('renders the permission row with its control, and NO execution-mode row', () => {
    const html = general();
    expect(html).toContain(SETTINGS_COPY['permission.title']);
    expect(html).toContain(SETTINGS_COPY['permission.description']);
    expect(html).toContain('aria-label="访问模式，当前：只读"');
    // The execution mode is not a standing preference. Which execution modes
    // exist is the providing PLUGIN's own business, and that plugin renders its
    // control on its own settings page — a host row here would mean the general
    // page keeping a vocabulary (and a frame) for a plugin it must not know.
    expect(html).not.toContain('执行模式');
  });

  it('renders the appearance cubes and the font stepper after the mode rows', () => {
    const html = general();
    expect(html).toContain(SETTINGS_COPY['appearance.title']);
    expect(html).toContain(SETTINGS_COPY['fontSize.title']);
    expect(html).toContain('>14</span>');
    // The reference's order: 权限 first, appearance, then the font axis.
    const at = (needle: string): number => html.indexOf(needle);
    expect(at(SETTINGS_COPY['permission.title'])).toBeLessThan(at(SETTINGS_COPY['appearance.title']));
    expect(at(SETTINGS_COPY['appearance.title'])).toBeLessThan(at(SETTINGS_COPY['fontSize.title']));
  });

  it('renders the work-details row with its four modes', () => {
    // The reference's 通用 page row: a select naming how much tool-call detail
    // the transcript shows. The static lane renders the trigger CLOSED, so the
    // markup carries the mode in force; the four option labels are asserted
    // where they live (the copy table the open menu reads).
    const html = general();
    expect(html).toContain(SETTINGS_COPY['transcript.title']);
    expect(html).toContain(SETTINGS_COPY['transcript.description']);
    expect(html).toContain('aria-label="工作步骤展示，当前：标准"');
    for (const key of ['transcript.compact', 'transcript.standard', 'transcript.detailed', 'transcript.verbose'] as const) {
      expect(SETTINGS_COPY[key]).not.toBe('');
    }
  });
});

describe('model section', () => {
  it('lists the catalog with the check on the model in force', () => {
    const html = renderToStaticMarkup(
      <ModelSection
        model="m2"
        switching
        catalog={{
          groups: [{
            id: 'g1',
            name: '测试网关',
            models: [
              { id: 'm1', name: 'Model One' },
              { id: 'm2', name: 'Model Two' },
            ],
          }],
          loading: false,
        }}
        send={() => undefined}
      />,
    );
    expect(html).toContain('测试网关');
    expect(html).toContain('Model One');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    const rows = html.split('<button');
    expect(rows[2]).toContain('aria-current="true"');
  });

  it('renders the catalog title and intro above the catalog rows', () => {
    const html = renderToStaticMarkup(
      <ModelSection model="m1" switching catalog={null} send={() => undefined} />,
    );
    const at = (needle: string): number => html.indexOf(needle);
    expect(at(SETTINGS_COPY['models.catalogTitle'])).toBeGreaterThan(-1);
    expect(at(SETTINGS_COPY['models.catalogIntro'])).toBeGreaterThan(-1);
    expect(at(SETTINGS_COPY['models.catalogTitle'])).toBeLessThan(at(SETTINGS_COPY['models.catalogIntro']));
  });

  it('renders the loading and empty readings from the copy table', () => {
    const loading = renderToStaticMarkup(
      <ModelSection model="m1" switching catalog={{ groups: [], loading: true }} send={() => undefined} />,
    );
    expect(loading).toContain(SETTINGS_COPY['models.loading']);
    const empty = renderToStaticMarkup(
      <ModelSection model="m1" switching catalog={{ groups: [], loading: false }} send={() => undefined} />,
    );
    expect(empty).toContain(SETTINGS_COPY['models.empty']);
  });
});

describe('plugins section', () => {
  const pluginsProps = { plugins: null, disabled: false, manageError: null, onClose: () => undefined } as const;

  it('shows WHY a failed row has no fiber once the row is open', () => {
    // An enabled extension whose package could not load arrives as
    // `state: 'failed'` + `error`; the reason renders in the expanded detail —
    // the reader acting on this row is the one who can fix it.
    const html = renderToStaticMarkup(
      <PluginRow
        entry={{
          name: 'context',
          state: 'failed',
          inject: [],
          enabled: false,
          origin: 'extension',
          title: '上下文洞察',
          error: '无法加载 @nova-agent/plugin-context：module not found',
        }}
        switchable
        advanced
        open
        disabled={false}
        lockedNote={null}
        switching={null}
        onToggle={() => undefined}
        onFlip={() => undefined}
      />,
    );
    expect(html).toContain(SETTINGS_COPY['pluginState.failed']);
    expect(html).toContain('加载失败：无法加载 @nova-agent/plugin-context：module not found');
  });
  it('renders roster rows with the localized state and the tier group', () => {
    const html = renderToStaticMarkup(
      <PluginsSection
        roster={{
          entries: [
            { name: 'fs', state: 'active', inject: ['tools'] },
            { name: 'todo', state: 'active', inject: [] },
          ],
          configPath: 'C:\\Users\\someone\\.nova\\config.json',
        }}
        send={() => undefined}
        {...pluginsProps}
      />,
    );
    // An old host sends no `title`/`tier`: the row falls back to the identifier
    // and to the switchable `standard` group rather than inventing either.
    expect(html).toContain('>fs</span>');
    // The wire carries the container's own `FiberState`; the row reads the
    // dictionary's word for it, never the mechanical name.
    expect(html).toContain(SETTINGS_COPY['pluginState.active']);
    expect(html).not.toContain('>active ·');
    expect(html).toContain('>todo</span>');
    expect(html).toContain(SETTINGS_COPY['config.title']);
    expect(html).toContain(SETTINGS_COPY['config.copy']);
    expect(html).toContain('.nova\\config.json');
    // Injected services live in the EXPANDED area, so the collapsed row stays
    // scannable: the collapsed markup must not carry the service name.
    expect(html).not.toContain('tools');
  });

  it('gives a core row no switch, and an advanced row the default-off tag', () => {
    // Defect B's user-visible half: a core name used to render a switch that
    // threw on every click. The page must not offer a control the kernel refuses.
    const html = renderToStaticMarkup(
      <PluginsSection
        roster={{
          entries: [
            { name: 'fs-read', state: 'active', inject: [], tier: 'core', title: '读取文件' },
            { name: 'subagent', state: 'disabled', inject: [], enabled: false, tier: 'advanced', title: '子代理', description: '为自包含的子任务启动隔离子代理。' },
          ],
          configPath: 'C:\\cfg.json',
        }}
        send={() => undefined}
        {...pluginsProps}
      />,
    );
    // The Chinese titles are what the reader sees…
    expect(html).toContain('读取文件');
    expect(html).toContain('子代理');
    // …the tier groups are the page's structure…
    expect(html).toContain(SETTINGS_COPY['plugins.coreGroup']);
    expect(html).toContain(SETTINGS_COPY['plugins.advancedGroup']);
    // …a core row has exactly ONE switch-less row, and the advanced row has one
    // switch, so the count of `role="switch"` is 1 for these two rows.
    expect(html.match(/role="switch"/gu)?.length).toBe(1);
    expect(html).toContain(SETTINGS_COPY['plugins.defaultOff']);
    // The row is a disclosure: `aria-expanded` is what the expanded area keys off.
    expect(html).toContain('aria-expanded="false"');
  });

  it('renders the page head above the roster', () => {
    const html = renderToStaticMarkup(
      <PluginsSection roster={{ entries: [], configPath: 'C:\\cfg.json' }} send={() => undefined} {...pluginsProps} />,
    );
    const at = (needle: string): number => html.indexOf(needle);
    expect(at(SETTINGS_COPY['plugins.title'])).toBeGreaterThan(-1);
    expect(at(SETTINGS_COPY['plugins.intro'])).toBeGreaterThan(-1);
    // Reference order: heading, then intro.
    expect(at(SETTINGS_COPY['plugins.title'])).toBeLessThan(at(SETTINGS_COPY['plugins.intro']));
  });

  it('renders the loading reading before the first answer lands', () => {
    const html = renderToStaticMarkup(<PluginsSection roster={null} send={() => undefined} {...pluginsProps} />);
    expect(html).toContain(SETTINGS_COPY['plugins.loading']);
    // The config-path row needs a roster to name a path, so it is absent here.
    // Asserting its TITLE is not enough: the intro sentence legitimately ends
    // with 配置文件, so the bare phrase appears either way. The copy control is
    // the unambiguous marker of the loaded row.
    expect(html).not.toContain(SETTINGS_COPY['config.copy']);
  });

  it('offers the search box only once there is a roster to filter', () => {
    // Nothing to filter is not a search box: an empty deployment shows the
    // empty reading instead.
    const empty = renderToStaticMarkup(
      <PluginsSection roster={{ entries: [], configPath: 'C:\\cfg.json' }} send={() => undefined} {...pluginsProps} />,
    );
    expect(empty).toContain(SETTINGS_COPY['plugins.empty']);
    expect(empty).not.toContain(SETTINGS_COPY['plugins.search']);

    const loaded = renderToStaticMarkup(
      <PluginsSection
        roster={{ entries: [{ name: 'fs', state: 'active', inject: ['tools'] }], configPath: 'C:\\cfg.json' }}
        send={() => undefined}
        {...pluginsProps}
      />,
    );
    expect(loaded).toContain(SETTINGS_COPY['plugins.search']);
    expect(loaded).not.toContain(SETTINGS_COPY['plugins.empty']);
  });

  it('distinguishes a search with no hits from an empty roster', () => {
    // The filter is real state, so the "no match" reading is only reachable by
    // driving it; its copy must not be the empty-roster reading.
    expect(SETTINGS_COPY['plugins.emptySearch']).not.toBe(SETTINGS_COPY['plugins.empty']);
  });

  it('marks the search field as the owner of Escape while it has focus', () => {
    // `shell/modal-layer.ts` yields Escape to a focused text field ("inside one,
    // Escape belongs to that field, never to the chrome"). That yield is only
    // sound while the field DOES something with the key: a box that swallows it
    // leaves Escape dead and the reader with no way out but the mouse. The
    // attribute is what makes the yield auditable from the markup.
    const loaded = renderToStaticMarkup(
      <PluginsSection
        roster={{ entries: [{ name: 'fs', state: 'active', inject: ['tools'] }], configPath: 'C:\\cfg.json' }}
        plugins={null}
        disabled={false}
        manageError={null}
        send={() => undefined}
      />,
    );
    expect(loaded).toContain('data-modal-escape-owner');
    // And it is only present alongside the field itself.
    const empty = renderToStaticMarkup(
      <PluginsSection roster={{ entries: [], configPath: 'C:\\cfg.json' }} plugins={null} disabled={false} manageError={null} send={() => undefined} />,
    );
    expect(empty).not.toContain('data-modal-escape-owner');
  });
});
