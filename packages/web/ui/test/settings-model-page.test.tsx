/**
 * 设置页「模型」页的三条用户可见契约，全部走无 DOM 车道（`renderToStaticMarkup` +
 * 纯函数）。每个缺陷只钉一条断言：
 *
 *  1. **多供应商一眼分清** —— 活动项带 `当前使用` 与 `data-active`，且**与顺序无关**；
 *     每个供应商显示自己的地址与模型数；没有密钥的行「设为当前」禁用并写明原因
 *     （宿主确实会拒绝：`set_provider` 需要已存密钥）。
 *  2. **当前模型的参数可编辑** —— 每个能力字段都有输入控件，并同时显示「当前生效」
 *     与「自动值（占位）」；容量接受 `256K` / `1M`；越界值被拒绝而不是写坏配置
 *     （config schema 是 `.strict()` 的，写进去会让整份配置加载失败）。
 *  3. **没有裸控件** —— 三个版块渲染出的每个 input/select/button 都带模块类名，
 *     不出现浏览器默认样式。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelConfigEditor, formatCapacity, parseCapacityField, parseCapacityText } from '../src/settings/ModelConfigEditor.js';
import { ModelSection } from '../src/settings/ModelSection.js';
import { ProviderSection } from '../src/settings/ProviderSection.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';
import type { ModelConfigSnapshot, ProvidersSnapshot } from '../src/state.js';

const noop = (): void => undefined;

/** 两个端点：第二个才是在役的（顺序与在役无关）。 */
const TWO_PROVIDERS: ProvidersSnapshot = {
  activeId: 'p2',
  providers: [
    { id: 'p1', name: '自建网关', baseURL: 'https://gw.example.com/v1', hasApiKey: true, models: [{ id: 'a' }] },
    { id: 'p2', name: '官方', baseURL: 'https://api.example.com/v1', hasApiKey: true, models: [{ id: 'b' }, { id: 'c' }] },
  ],
};

const CONFIG: ModelConfigSnapshot = {
  models: [{ id: 'deepseek-chat', name: '对话', contextWindow: 128000, inputModalities: ['text', 'image'] }],
  published: ['deepseek-chat', 'deepseek-reasoner'],
  automatic: {
    'deepseek-chat': {
      contextWindow: 256000,
      maxOutput: 8192,
      inputModalities: ['text'],
      attachment: true,
      toolCall: true,
    },
  },
};

/** 每个控件标签（input/select/button/textarea）都带 `class="`。 */
function unstyledControls(html: string): string[] {
  const tags = html.match(/<(?:input|select|button|textarea)\b[^>]*>/g) ?? [];
  return tags.filter((tag) => !/\bclass="/.test(tag));
}

describe('模型页 · 多供应商一眼分清', () => {
  it('marks the active provider by name and attribute, not by list order', () => {
    const html = renderToStaticMarkup(<ProviderSection providers={TWO_PROVIDERS} probe={null} send={noop} />);
    // 活动项是列表里的**第二**项：标记必须跟着 id 走。
    const second = html.slice(html.indexOf('data-provider="p2"'));
    expect(second).toContain('data-active="true"');
    expect(html.slice(0, html.indexOf('data-provider="p2"'))).not.toContain('data-active="true"');
    // 一个词加一个点，而不是靠顺序暗示（`>当前使用<` 是标记元素本身；说明里也提到这四个字）。
    expect(html.match(/>当前使用</g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${SETTINGS_COPY['models.providerKeySet']}"`);
    // 在役那一行没有「设为当前」，另一行有。
    expect(html).not.toContain('data-provider-use="p2"');
    expect(html).toContain('data-provider-use="p1"');
  });

  it('names every provider with its address and its model count', () => {
    const html = renderToStaticMarkup(<ProviderSection providers={TWO_PROVIDERS} probe={null} send={noop} />);
    expect(html).toContain('https://api.example.com/v1');
    expect(html).toContain('https://gw.example.com/v1');
    expect(html).toContain(`2 ${SETTINGS_COPY['models.providerModelCount']}`);
    expect(html).toContain(`1 ${SETTINGS_COPY['models.providerModelCount']}`);
  });

  it('refuses to offer a switch the host would reject, and says why', () => {
    // `set_provider` refuses without a stored key; a button that throws on click
    // is the defect, so the row states the reason instead.
    const html = renderToStaticMarkup(
      <ProviderSection
        providers={{ activeId: 'p1', providers: [...TWO_PROVIDERS.providers.slice(0, 1), { ...TWO_PROVIDERS.providers[1]!, hasApiKey: false }] }}
        probe={null}
        send={noop}
      />,
    );
    const keyless = html.slice(html.indexOf('data-provider="p2"'));
    expect(keyless).toContain(`title="${SETTINGS_COPY['models.providerKeyMissing']}"`);
    expect(keyless).toContain('data-provider-use="p2" disabled=""');
    expect(html).toContain(`aria-label="${SETTINGS_COPY['models.providerKeyMissing']}"`);
  });
});

describe('模型目录 · 在用模型属于哪个端点', () => {
  it('names the endpoint above the list and marks the row in force', () => {
    const html = renderToStaticMarkup(
      <ModelSection
        model="m2"
        switching
        catalog={{
          groups: [{ id: 'endpoint', name: 'api.example.com', models: [{ id: 'm1', name: 'A' }, { id: 'm2', name: 'B' }] }],
          loading: false,
        }}
        send={noop}
      />,
    );
    expect(html).toContain('api.example.com');
    expect(html).toContain(SETTINGS_COPY['models.catalogCurrent']);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain(SETTINGS_COPY['models.inUse']);
  });

  it('states why the rows are inert when this kernel cannot switch', () => {
    const html = renderToStaticMarkup(
      <ModelSection
        model="m1"
        switching={false}
        catalog={{ groups: [{ id: 'endpoint', name: 'gw', models: [{ id: 'm1', name: 'A' }] }], loading: false }}
        send={noop}
      />,
    );
    expect(html).toContain(SETTINGS_COPY['models.catalogReadOnly']);
    expect(html).toContain('disabled=""');
  });
});

describe('模型参数 · 当前生效与自动值', () => {
  it('edits every capability field and shows both readings', () => {
    const html = renderToStaticMarkup(<ModelConfigEditor config={CONFIG} writable send={noop} />);
    // 手动覆盖：值在输入框里（按 K/M 词法拼写），且标注「手动」；自动源给的另一个数仍以占位符出现。
    expect(html).toContain('value="128K"');
    expect(html).toContain(`placeholder="${SETTINGS_COPY['models.configAutoLabel']} 256K"`);
    expect(html).toContain(`${SETTINGS_COPY['models.configEffectiveLabel']} ${SETTINGS_COPY['models.configEffectiveManual']} 128K`);
    // 未覆盖的字段：当前生效 = 自动，占位符给自动值。
    expect(html).toContain(`${SETTINGS_COPY['models.configEffectiveLabel']} ${SETTINGS_COPY['models.configEffectiveAuto']}`);
    expect(html).toContain(`placeholder="${SETTINGS_COPY['models.configAutoLabel']} 8192"`);
    // 三个开关 + 两组模态勾选都在。
    expect(html.match(/<select/g)).toHaveLength(3);
    expect(html.match(/type="checkbox"/g)).toHaveLength(10);
    expect(html).toContain(SETTINGS_COPY['models.fieldAttachment']);
    expect(html).toContain(SETTINGS_COPY['models.fieldReasoning']);
    expect(html).toContain(SETTINGS_COPY['models.fieldToolCall']);
    expect(html).toContain(SETTINGS_COPY['models.fieldInputModalities']);
    expect(html).toContain(SETTINGS_COPY['models.fieldOutputModalities']);
  });

  it('offers the endpoint\'s own ids as one-click candidates', () => {
    const html = renderToStaticMarkup(<ModelConfigEditor config={CONFIG} writable send={noop} />);
    // 已在清单里的 id 不再作为候选（否则「添加」会造出重复行）。
    expect(html).toContain('data-model-candidate="deepseek-reasoner"');
    expect(html).not.toContain('data-model-candidate="deepseek-chat"');
  });

  it('says which list decides the menu instead of showing an empty editor', () => {
    const html = renderToStaticMarkup(
      <ModelConfigEditor config={{ models: [], published: [], automatic: {} }} writable send={noop} />,
    );
    expect(html).toContain(SETTINGS_COPY['models.configInherited']);
    expect(html).toContain(SETTINGS_COPY['models.configPublishedEmpty']);
  });

  it('refuses an out-of-range capacity instead of writing a config that will not load', () => {
    // 20 亿超过 schema 的上限：写进文件会让 `loadConfig` 直接失败，所以必须挡在这里。
    const html = renderToStaticMarkup(
      <ModelConfigEditor
        config={{ models: [{ id: 'x', contextWindow: 2_000_000_000 }], published: [], automatic: {} }}
        writable
        send={noop}
      />,
    );
    expect(html).toContain(`role="alert"`);
    expect(html).toContain(SETTINGS_COPY['models.configRangeExceeded']);
    expect(html).toContain('aria-invalid="true"');
    // React renders a valueless boolean attribute as `="true"`.
    expect(html).toContain('data-model-save="true" disabled=""');
  });

  it('refuses an out-of-range temperature on the provider card for the same reason', () => {
    const html = renderToStaticMarkup(
      <ProviderSection
        providers={{
          activeId: 'p1',
          providers: [{ id: 'p1', name: '官方', baseURL: 'https://api.example.com/v1', hasApiKey: true, temperature: 3, models: [] }],
        }}
        probe={null}
        send={noop}
      />,
    );
    expect(html).toContain(SETTINGS_COPY['models.configRangeExceeded']);
    expect(html).toContain('data-provider-save="true" disabled=""');
  });
});

describe('模型页 · 样式护栏（没有裸控件）', () => {
  it('gives every control a module class', () => {
    const html = [
      renderToStaticMarkup(<ProviderSection providers={TWO_PROVIDERS} probe={null} send={noop} />),
      renderToStaticMarkup(
        <ModelSection
          model="m1"
          switching
          catalog={{ groups: [{ id: 'endpoint', name: 'gw', models: [{ id: 'm1', name: 'A' }] }], loading: false }}
          send={noop}
        />,
      ),
      renderToStaticMarkup(<ModelConfigEditor config={CONFIG} writable send={noop} />),
    ].join('\n');
    expect(unstyledControls(html)).toEqual([]);
  });

  it('orders the three steps under one page head', () => {
    const provider = renderToStaticMarkup(<ProviderSection providers={TWO_PROVIDERS} probe={null} send={noop} />);
    const model = renderToStaticMarkup(
      <ModelSection model="m1" switching catalog={null} send={noop} />,
    );
    const config = renderToStaticMarkup(<ModelConfigEditor config={CONFIG} writable send={noop} />);
    const at = (html: string, needle: string): number => html.indexOf(needle);
    expect(at(provider, SETTINGS_COPY['models.title'])).toBeGreaterThan(-1);
    expect(at(provider, '第 1 步')).toBeGreaterThan(at(provider, SETTINGS_COPY['models.title']));
    expect(at(model, '第 2 步')).toBeGreaterThan(-1);
    expect(at(config, '第 3 步')).toBeGreaterThan(-1);
  });
});

describe('容量词法（纯函数）', () => {
  it('reads K/M suffixes and spells them back', () => {
    expect(parseCapacityText('256K')).toBe(256_000);
    expect(parseCapacityText('1M')).toBe(1_000_000);
    expect(parseCapacityText('')).toBeUndefined();
    expect(Number.isNaN(parseCapacityText('abc'))).toBe(true);
    expect(formatCapacity(256_000)).toBe('256K');
    expect(formatCapacity(1_000_000)).toBe('1M');
    expect(formatCapacity(8192)).toBe('8192');
  });

  it('bounds a count against its own field and reports the rule it broke', () => {
    expect(parseCapacityField('128K', 200_000_000)).toEqual({ ok: true, value: 128_000 });
    expect(parseCapacityField('', 200_000_000)).toEqual({ ok: true, value: undefined });
    expect(parseCapacityField('nope', 200_000_000)).toMatchObject({ ok: false });
    expect(parseCapacityField('-1', 200_000_000)).toMatchObject({ ok: false });
    expect(parseCapacityField('300M', 200_000_000)).toMatchObject({ ok: false });
  });
});
