/**
 * The reported settings defects that are NOT about one plugin's page, one
 * assertion each.
 *
 * These are deliberately about the SYMPTOM the user described rather than about
 * the code's shape, because every one of them looked fine in isolation:
 *
 *  1. 「按钮开关我都看不出是开还是关」 — three sections drew their own pill, and
 *     all three used a 14%-white overlay for ON against a solid dark gray for
 *     OFF. In dark mode those are nearly the same colour. The shared `Switch`
 *     keys its fill off `aria-checked`, so what the eye sees and what assistive
 *     technology reads are one bit — and the ON/OFF colours are a real luminance
 *     inversion instead of two shades of gray.
 *  2. 「开关没有实际功能」 / refusals invisible — the reducer parks a refusal in
 *     `manageError`, and NOTHING rendered its message, so "运行中不能切换" and
 *     "核心功能不可关闭" both reached nobody. The channel is SHARED by every
 *     managed section, so attributing a refusal to the section that was actually
 *     waiting is the fix, and it lives in `use-manage-refusal.ts`.
 *  3. 「开了 subagent agent 还说没有这个工具」 — the backend is correct (verified
 *     end to end by the Lead), so the gap was feedback: a landed flip said
 *     nothing, and the reader had no way to know the effect is real and when it
 *     starts.
 *  4. 「不是让用户看不懂」 — the model page was three sibling `<h2>`s with no
 *     indication they are one flow, and the Skill page named its levels without
 *     saying where the files go.
 *
 * A plugin's OWN page (whatever plugin that is) is not covered here: the host
 * stopped knowing plugin names, so a section that renders one plugin's fields is
 * that plugin's business, not this lane's.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ManageError } from '../src/settings/ManageError.js';
import { PluginGroup } from '../src/settings/PluginRow.js';
import { PluginsSection } from '../src/settings/PluginsSection.js';
import { ProviderSection } from '../src/settings/ProviderSection.js';
import { SkillsSection } from '../src/settings/SkillsSection.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';
import { refusalToShow } from '../src/settings/use-manage-refusal.js';
import type { PluginRowGroup } from '../src/settings/row-model.js';

const noop = (): void => undefined;

/** A group with one switchable row, so the group renders a control. */
function group(overrides: Partial<PluginRowGroup> = {}): PluginRowGroup {
  return {
    tier: 'standard',
    switchable: true,
    rows: [{ name: 'bash', state: 'active', inject: [], enabled: true, tier: 'standard', title: '执行命令' }],
    ...overrides,
  };
}

/** The 插件管理 page's switchable group, drawn as the page draws it. */
const pluginGroup = (): string =>
  renderToStaticMarkup(
    <PluginGroup
      group={group()}
      title="基础能力"
      open
      foldable
      expanded={new Set()}
      disabled={false}
      lockedNote={null}
      switching={null}
      onToggleGroup={noop}
      onToggle={noop}
      onFlip={noop}
    />,
  );

/** The Skill 中心 page, whose rows carry the same shared switch. */
const skillsSection = (disabled = false): string =>
  renderToStaticMarkup(
    <SkillsSection
      skills={{ items: [{ name: 'alpha', description: 'a', source: 'project', enabled: true }], disable: [] }}
      disabled={disabled}
      manageError={null}
      send={noop}
    />,
  );

describe('root cause 1 · the switch reads as on or off', () => {
  it('writes the state to aria-checked, with no parallel data-on attribute', () => {
    // `data-on` beside `aria-checked` is two state sources that can drift, and
    // the shared Switch draws from `aria-checked[='true']` — so this is also the
    // assertion that the visual state cannot disagree with the announced one.
    const html = pluginGroup();
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('data-on');
  });

  it('draws no section-local pill, so the appearance cannot drift again', () => {
    // Rendering the managed pages and looking for the OLD markup is the honest
    // check here: a local pill was a raw `<button>` with `data-on`, so any
    // survivor shows up as that attribute. Reading the sheets instead would be
    // asserting on source text rather than on what the pages produce.
    const pages = [pluginGroup(), skillsSection()];
    for (const html of pages) expect(html).not.toContain('data-on');
    // Both pages that HAVE a control render the shared one, which is what makes
    // one definition the whole story.
    expect(pages[0]).toContain('aria-checked');
    expect(pages[1]).toContain('aria-checked');
  });
});

describe('root cause 2 · a refusal is visible', () => {
  it('decides the banner from "were we waiting", not from the shared channel alone', () => {
    // The channel is shared, so the decision is the fix and it lives in a pure
    // function precisely so this can be pinned: a page that sent nothing must
    // not re-draw the previous page's failure, and a page that DID send must show
    // the host's reason verbatim (not a paraphrase).
    const refusal = { seq: 7, message: '本轮运行中不能切换插件开关' };
    expect(refusalToShow(true, refusal)).toBe('本轮运行中不能切换插件开关');
    expect(refusalToShow(false, refusal)).toBeNull();
    expect(refusalToShow(true, null)).toBeNull();
  });

  it('draws the banner as an alert, carrying the host\'s sentence untouched', () => {
    // `role="alert"` because the sentence appears as the direct answer to a
    // press: it must be announced, not merely present in the DOM.
    const html = renderToStaticMarkup(<ManageError message="本轮运行中不能切换插件开关" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('本轮运行中不能切换插件开关');
    expect(html).toContain(SETTINGS_COPY['manage.errorTitle']);
    // No refusal, no banner: an empty alert box would be worse than none.
    expect(renderToStaticMarkup(<ManageError message={null} />)).toBe('');
  });

  it('says why the switches are locked, on the page and on the control', () => {
    // A disabled control with no stated reason reads as a broken row, which is
    // what the report described. The reason is said twice on purpose: once as
    // page prose, and once as the control's own `title`, so it is reachable on
    // hover and by assistive technology rather than only as distant text.
    const note = SETTINGS_COPY['plugins.lockNote'];
    const html = skillsSection(true);
    expect(html).toContain('disabled=""');
    // Twice: once inside the control's `title`, once as the page's own prose.
    // Counting is what makes this test about the two PLACEMENTS rather than
    // about the sentence existing somewhere.
    const occurrences = html.split(note).length - 1;
    expect(occurrences).toBe(2);
    expect(html).toContain(`title="${note}"`);
  });
});

describe('root cause 3 · a landed flip says so', () => {
  it('tells the reader the effect is real and when it starts', () => {
    // The backend already works (the Lead's end-to-end probe); what was missing
    // is this sentence. The copy must state WHEN it takes effect, because
    // "已启用" alone does not answer "why does the agent still not see it" —
    // a live turn was built from the tool set in force when it started.
    expect(SETTINGS_COPY['plugins.appliedOn']).toContain('生效');
    expect(SETTINGS_COPY['plugins.appliedOn']).toContain('{name}');
    expect(SETTINGS_COPY['plugins.appliedOff']).toContain('{name}');
  });
});

describe('root cause 4 · the pages explain themselves', () => {
  it('keeps one page head and plain section headings (no step theatre)', () => {
    // The three sections used to carry "第 N 步" markers under three sibling
    // `<h2>`s. That marker was a claim about sequence the markup had to keep
    // true; once the page head owns the title and the sections go back to plain
    // headings, the three read as one page without it. So the markers are gone —
    // and a stray one reappearing anywhere (including the plugin page, which is
    // NOT part of this flow) would be that untrue claim coming back.
    const page = renderToStaticMarkup(<ProviderSection providers={null} probe={null} send={noop} />);
    expect(page).toContain(SETTINGS_COPY['models.providerTitle']);
    const plugins = renderToStaticMarkup(
      <PluginsSection
        roster={{ entries: [], configPath: '/cfg.json' }}
        plugins={null}
        disabled={false}
        manageError={null}
        send={noop}
      />,
    );
    expect(page + plugins).not.toContain('第 1 步');
  });

  it('states each Skill discovery ROOT, not just its level name', () => {
    // "项目级" is a category; a reader who wants to add a skill needs a path.
    const html = renderToStaticMarkup(
      <SkillsSection
        skills={{
          items: [
            { name: 'alpha', description: 'a', source: 'project', enabled: true },
            { name: 'beta', description: 'b', source: 'user', enabled: true },
          ],
          disable: [],
        }}
        disabled={false}
        manageError={null}
        send={noop}
      />,
    );
    expect(html).toContain(SETTINGS_COPY['skills.projectRoot']);
    expect(html).toContain(SETTINGS_COPY['skills.userRoot']);
    // Counted per root, so "放错目录" is distinguishable from "没加载".
    expect(html).toContain('1 个');
  });
});
