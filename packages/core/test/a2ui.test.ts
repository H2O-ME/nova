import { describe, expect, it } from 'vitest';
import { MAX_A2UI_COMPONENTS, parseA2uiMessages } from '../src/a2ui.js';

const create = { version: '1.0', createSurface: { surfaceId: 'main' } };

describe('parseA2uiMessages', () => {
  it('accepts the create → components → data sequence', () => {
    const parsed = parseA2uiMessages([
      create,
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'main',
          components: [
            { id: 'root', component: 'Column', children: ['title', 'submit'] },
            { id: 'title', component: 'Text', text: { path: '/heading' } },
            { id: 'submit', component: 'Button', child: 'label', action: { event: { name: 'ok' } } },
            { id: 'label', component: 'Text', text: 'OK' },
          ],
        },
      },
      { version: '1.0', updateDataModel: { surfaceId: 'main', path: '/heading', value: 'Hello' } },
    ]);
    expect(parsed).toHaveLength(3);
    expect(parsed?.[0]).toEqual(create);
  });

  it('rejects an unknown component, a duplicate id, or two payloads in one message', () => {
    const component = (id: string, name: string): Record<string, unknown> => ({ id, component: name });
    expect(parseA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [component('root', 'FancyTable')] } },
    ])).toBeUndefined();
    expect(parseA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [component('root', 'Text'), component('root', 'Text')] } },
    ])).toBeUndefined();
    expect(parseA2uiMessages([{ createSurface: { surfaceId: 'main' }, deleteSurface: { surfaceId: 'main' } }])).toBeUndefined();
    // A path-bound prop still has to be JSON-safe data.
    expect(parseA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [{ id: 'root', component: 'Text', text: '\u0000' }] } },
    ])).toBeUndefined();
  });

  it('caps the component table and the serialized payload', () => {
    const components = Array.from({ length: MAX_A2UI_COMPONENTS + 1 }, (_, index) => ({ id: `c${String(index)}`, component: 'Text', text: 'x' }));
    expect(parseA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components } },
    ])).toBeUndefined();
  });
});
