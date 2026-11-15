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
import { AppearanceSection } from '../src/settings/AppearanceSection.js';
import { ProviderModelsDialog, filterCandidates } from '../src/settings/ProviderModelsDialog.js';
import { ProviderSection } from '../src/settings/ProviderSection.js';
import { SkillsSection } from '../src/settings/SkillsSection.js';
import { PluginGroup, PluginRow } from '../src/settings/PluginRow.js';
import { PluginsSection } from '../src/settings/PluginsSection.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';

const general = (): string =>
  renderToStaticMarkup(
    <GeneralSection
      approvalMode="read-only"
      disabled={false}
      transcriptView="standard"
      onPickApproval={() => undefined}
      onPickTranscriptView={() => undefined}
    />,
  );

const appearance = (): string =>
  renderToStaticMarkup(
    <AppearanceSection
      preference="dark"
      fontSize={14}
      onPickPreference={() => undefined}
      onPickFontSize={() => undefined}
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

  it('leaves appearance to its OWN page: no theme/font rows on 常规', () => {
    // 2026-11-15: the reference keeps appearance on its own `appearance` page,
    // so 常规 carries only the execution axes now.
    const html = general();
    expect(html).not.toContain(SETTINGS_COPY['appearance.title']);
    expect(html).not.toContain(SETTINGS_COPY['fontSize.title']);
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

describe('appearance section', () => {
  it('renders the theme select and the font field under the 界面设置 head', () => {
    const html = appearance();
    expect(html).toContain(SETTINGS_COPY['appearance.title']);
    expect(html).toContain(SETTINGS_COPY['fontSize.title']);
    // The font axis is the reference's number field now, not a stepper pill.
    expect(html).toContain('type="number"');
    expect(html).toContain('value="14"');
    expect(html).toContain(SETTINGS_COPY['general.groupUi']);
    const at = (needle: string): number => html.indexOf(needle);
    expect(at(SETTINGS_COPY['appearance.title'])).toBeLessThan(at(SETTINGS_COPY['fontSize.title']));
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
  it('reads the description ON the collapsed row, and never twice when open', () => {
    // The reference prints a package row's one-line description in the collapsed
    // state — it is what tells two plugin names apart. Nova kept it behind the
    // disclosure, so a reader scanning the list saw names and identifiers only.
    const entry = {
      name: 'subagent',
      state: 'active',
      inject: ['tools'],
      enabled: true,
      tier: 'advanced',
      title: '子代理',
      description: '为自包含的子任务启动隔离子代理。',
    } as const;
    const props = {
      entry,
      switchable: true,
      advanced: true,
      disabled: false,
      lockedNote: null,
      switching: null,
      onToggle: () => undefined,
      onFlip: () => undefined,
    } as const;
    const collapsed = renderToStaticMarkup(<PluginRow {...props} open={false} />);
    expect(collapsed).toContain('为自包含的子任务启动隔离子代理。');
    // Exactly once when the row is unfolded too: the detail carries what the row
    // cannot (what it injects), never a second copy of the description.
    const expanded = renderToStaticMarkup(<PluginRow {...props} open />);
    expect(expanded.match(/为自包含的子任务启动隔离子代理。/gu)).toHaveLength(1);
    expect(expanded).toContain('依赖：tools');
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

  it('folds the switchless group at its FOOT, keeps the switchable one open, and counts both', () => {
    // Defect B's user-visible half: a core name used to render a switch that
    // threw on every click. The page must not offer a control the kernel refuses.
    //
    // And the core rows must not stand in front of the ones that DO have
    // controls: 17 of them put the first live switch 706px below the fold of a
    // 720px window (「都藏在页面最底部」). So the switchless group arrives folded
    // — with its row count on the header, so nothing disappears silently — while
    // the group the reader can act on arrives open.
    //
    // ZCode evidence: the group's subject is PLAIN text and the fold lives at
    // the group's foot (`PluginStoreListView.tsx:301-307`, `353-397`), so there
    // is no chevron or button on the header; a folded group keeps its first six
    // cards (`CATEGORY_VISIBLE_LIMIT`, line 28) and states the rest as
    // 查看其余 N 项.
    const coreRows = Array.from({ length: 8 }, (_, index) => ({
      name: `core-${String(index)}`,
      state: 'active' as const,
      inject: [],
      tier: 'core' as const,
      title: `核心 ${String(index)}`,
    }));
    const html = renderToStaticMarkup(
      <PluginsSection
        roster={{
          entries: [
            ...coreRows,
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
    // …the switchless group's header is static text that counts its rows…
    const coreSection = html.indexOf(`aria-label="${SETTINGS_COPY['plugins.coreGroup']}"`);
    const coreHead = html.slice(coreSection, html.indexOf('<ul', coreSection));
    expect(coreHead).toContain('· 8');
    expect(coreHead).not.toContain('<button');
    // …its first six rows are on the page and the remaining two are stated by
    // the foot hint instead of silently disappearing…
    expect(html).toContain('核心 5');
    expect(html).not.toContain('核心 6');
    expect(html).toContain(SETTINGS_COPY['plugins.viewMore'].replace('{count}', '2'));
    // …and the group with a control is open, carrying exactly one switch and
    // no 收起 (a single row is not worth folding).
    expect(html).toContain('子代理');
    expect(html.match(/role="switch"/gu)?.length).toBe(1);
    expect(html).toContain(SETTINGS_COPY['plugins.defaultOff']);
    expect(html).not.toContain(`>${SETTINGS_COPY['plugins.showLess']}</button>`);
    // The ROW is a disclosure too: `aria-expanded` is what its detail keys off.
    expect(html).toContain('aria-expanded="false"');
  });

  it('ends an OPEN long group in 收起, as the reference does', () => {
    // `CollapsibleCardGroup` only draws showLess when expanded AND the group has
    // more than its teaser count (PluginStoreListView.tsx:387-397): an open
    // group of three cards has nothing to fold back, so no control is drawn.
    const rows = Array.from({ length: 7 }, (_, index) => ({
      name: `core-${String(index)}`,
      state: 'active' as const,
      inject: [],
      tier: 'core' as const,
      title: `核心 ${String(index)}`,
    }));
    const open = renderToStaticMarkup(
      <PluginGroup
        group={{ tier: 'core', switchable: false, rows }}
        title={SETTINGS_COPY['plugins.coreGroup']}
        open
        foldable
        expanded={new Set()}
        disabled={false}
        lockedNote={null}
        switching={null}
        onToggleGroup={() => undefined}
        onToggle={() => undefined}
        onFlip={() => undefined}
      />,
    );
    expect(open).toContain('核心 6');
    expect(open).toContain(`>${SETTINGS_COPY['plugins.showLess']}</button>`);
    expect(open).not.toContain(SETTINGS_COPY['plugins.viewMore'].split('{count}')[0]);
  });

  it('renders the market head above the roster', () => {
    const html = renderToStaticMarkup(
      <PluginsSection roster={{ entries: [], configPath: 'C:\\cfg.json' }} send={() => undefined} {...pluginsProps} />,
    );
    const at = (needle: string): number => html.indexOf(needle);
    expect(at(SETTINGS_COPY['plugins.title'])).toBeGreaterThan(-1);
    // The reference's market head carries the page name and its actions on ONE
    // row, with no subtitle: the store page dropped the intro so the first
    // screen starts at the catalog.
    expect(at(SETTINGS_COPY['plugins.refresh'])).toBeGreaterThan(-1);
    expect(html).not.toContain(SETTINGS_COPY['plugins.intro']);
    expect(at(SETTINGS_COPY['plugins.title'])).toBeLessThan(at(SETTINGS_COPY['plugins.refresh']));
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

describe('模型页 · 供应商资源卡（ZCode 资源形态）', () => {
  // 对齐 ZCode `model-provider-section/SectionLayout.tsx:54-67`：说明在卡外、
  // 清单是一张卡、「添加」是组头的资源动作。旧稿把组标题塞进卡里、把添加做成
  // 列表末尾的整行按钮 —— 这两条断言把新的结构钉住。
  const providers = {
    activeId: 'p1',
    providers: [
      { id: 'p1', name: '端点一', baseURL: 'https://a.example.test/v1', hasApiKey: true, models: [] },
      { id: 'p2', name: '端点二', baseURL: 'https://b.example.test/v1', hasApiKey: true, models: [] },
    ],
  };

  it('heads the provider list with an h3 group title and no duplicate page h2', () => {
    const html = renderToStaticMarkup(
      <ProviderSection providers={providers} probe={null} send={() => undefined} />,
    );
    // 页名由设置壳的 `.pageTitle` 承担；section 自己不再重复一个「模型」h2。
    expect(html).not.toContain('<h2');
    expect(html).toContain('<h3');
    expect(html).toContain(SETTINGS_COPY['models.providerTitle']);
    expect(html).toContain(SETTINGS_COPY['models.providerIntro']);
  });

  it('puts the add action in the group head, before the rows it appends to', () => {
    const html = renderToStaticMarkup(
      <ProviderSection providers={providers} probe={null} send={() => undefined} />,
    );
    const add = html.indexOf('data-provider-add-new');
    expect(add).toBeGreaterThan(-1);
    expect(add).toBeLessThan(html.indexOf('<ul'));
    // 两行供应商是同一个列表里的两项，不是两张各自带框的卡。
    expect(html.match(/data-provider="p\d"/gu)).toHaveLength(2);
    expect(html.match(/<ul/gu)).toHaveLength(1);
  });
});

describe('Skill 页 · 资源列表（ZCode 资源形态）', () => {
  // 对齐 ZCode `settings/SkillsSection.tsx:602` + `SettingsResourceGroup.tsx:35-48`：
  // 每个来源是「资源组头 + 一张卡内分隔行」，行尾是开关。
  it('renders each source group as a header plus one list card, rows carrying switches', () => {
    const html = renderToStaticMarkup(
      <SkillsSection
        skills={{
          items: [
            { name: 'alpha', description: '第一件事', source: 'project', enabled: true },
            { name: 'beta', description: '', source: 'user', enabled: false },
          ],
          disable: [],
        }}
        disabled={false}
        manageError={null}
        send={() => undefined}
      />,
    );
    // 两个来源 = 两个组；每个组一条 <ul> 卡，行是卡里的 <li>。
    expect(html.match(/role="group"/gu)).toHaveLength(2);
    expect(html.match(/<ul/gu)).toHaveLength(2);
    expect(html.match(/<li /gu)).toHaveLength(2);
    expect(html.match(/role="switch"/gu)).toHaveLength(2);
    // 页名不重复成正文标题（设置壳的页标题是唯一的页名）。
    expect(html).not.toContain('<h2');
    // 发现根目录仍在组头里：组标题回答不了「文件该放哪」。
    expect(html).toContain(SETTINGS_COPY['skills.projectRoot']);
    expect(html).toContain(SETTINGS_COPY['skills.userRoot']);
  });
});
