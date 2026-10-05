/**
 * A server-render pass over the settings sections: no DOM, no browser —
 * `renderToStaticMarkup` walks the real JSX with real props. Pinned here: the
 * 通用设置 rows' copy and controls, the 模型 page's 取模弹窗 (the picker that adds
 * endpoint models to a provider card), and the 内置插件 roster's rows with the
 * config path's copy control. Effects (the fetch-on-open asks) live in the
 * browser by design; the static lane pins what renders once the data is here.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GeneralSection } from '../src/settings/GeneralSection.js';
import { ProviderModelsDialog, filterCandidates } from '../src/settings/ProviderModelsDialog.js';
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
  it('records the endpoint models the picker can add, and locks the ones already recorded', () => {
    // 设置页不再有可切换的模型目录：切换当前模型归 composer 的模型座位。这里钉的
    // 是取模弹窗的两条读法——已记录的行锁定（本弹窗只做「加」），未记录的行可勾。
    const html = renderToStaticMarkup(
      <ProviderModelsDialog
        candidates={['m1', 'm2']}
        existing={['m1']}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain(SETTINGS_COPY['models.pickTitle']);
    expect(html).toContain('data-pick-row="m1"');
    expect(html).toContain('data-pick-row="m2"');
    expect(html).toContain(SETTINGS_COPY['models.pickExisting']);
    expect(html).toContain('disabled=""');
  });

  it('filters the candidates by substring, case-insensitively', () => {
    const groups = ['DeepSeek-V4-Flash', 'GLM-4-Flash', 'BGE-M3'];
    expect(filterCandidates(groups, 'glm')).toEqual(['GLM-4-Flash']);
    expect(filterCandidates(groups, 'FLASH')).toEqual(['DeepSeek-V4-Flash', 'GLM-4-Flash']);
    expect(filterCandidates(groups, 'nope')).toEqual([]);
    // 空查询原样返回同一份引用（不过滤就不过滤，不做多余拷贝）。
    expect(filterCandidates(groups, '')).toBe(groups);
  });

  it('offers nothing to add when the endpoint published nothing', () => {
    const html = renderToStaticMarkup(
      <ProviderModelsDialog candidates={[]} existing={[]} onApply={() => undefined} onClose={() => undefined} />,
    );
    expect(html).toContain(SETTINGS_COPY['models.providerNoReachable']);
    // 没有可加的东西时「添加所选」按不动，而不是按了没反应。
    expect(html).toContain('data-pick-apply');
    expect(html).toContain('disabled=""');
  });

  it('offers NO pick-all verb when every on-screen row is locked', () => {
    // 分母是**可以勾的**行：一个全是「已在清单」锁定行的弹窗里，「全选」没有
    // 对象——按旧分母（含锁定行）它会显示「清空」，点下去却什么也不会发生。
    const html = renderToStaticMarkup(
      <ProviderModelsDialog
        candidates={['m1', 'm2']}
        existing={['m1', 'm2']}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('data-pick-row="m1"');
    expect(html).not.toContain('data-pick-all');
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

  it('folds the switchless group, keeps the switchable one open, and counts both', () => {
    // Defect B's user-visible half: a core name used to render a switch that
    // threw on every click. The page must not offer a control the kernel refuses.
    //
    // And the core rows must not stand in front of the ones that DO have
    // controls: 17 of them put the first live switch 706px below the fold of a
    // 720px window (「都藏在页面最底部」). So the switchless group arrives folded
    // — with its row count on the header, so nothing disappears silently — while
    // the group the reader can act on arrives open.
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
    // …the tier groups are the page's structure…
    expect(html).toContain(SETTINGS_COPY['plugins.coreGroup']);
    expect(html).toContain(SETTINGS_COPY['plugins.advancedGroup']);
    // …the switchless group's header is a CLOSED disclosure that counts its rows…
    const coreSection = html.indexOf(`aria-label="${SETTINGS_COPY['plugins.coreGroup']}"`);
    const coreHead = html.slice(html.indexOf('<button', coreSection), html.indexOf('</button>', coreSection));
    expect(coreHead).toContain('aria-expanded="false"');
    expect(coreHead).toContain('· 1');
    // …its row is behind the fold rather than on the page…
    expect(html).not.toContain('读取文件');
    // …and the group with a control is open, carrying exactly one switch.
    expect(html).toContain('子代理');
    expect(html.match(/role="switch"/gu)?.length).toBe(1);
    expect(html).toContain(SETTINGS_COPY['plugins.defaultOff']);
    // The ROW is a disclosure too: `aria-expanded` is what its detail keys off.
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
