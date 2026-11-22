import { describe, expect, it } from 'vitest';
import { explainA2uiMessages, MAX_A2UI_COMPONENTS, parseA2uiMessages } from '../src/a2ui.js';

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
            { id: 'title', component: 'Text', text: { '@path': '/heading' } },
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

  it('rejects a Text variant outside the catalog enum, keeping the title habit legal', () => {
    const root = (extra: Record<string, unknown>): Record<string, unknown>[] => [
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [{ id: 'root', component: 'Text', text: 'x', ...extra }] } },
    ];
    // A markdown heading is not in this catalog: `h2` cannot be a Text variant.
    expect(parseA2uiMessages(root({ variant: 'h2' }))).toBeUndefined();
    // The two real variants pass, and an ABSENT one is legal (it defaults).
    expect(parseA2uiMessages(root({ variant: 'caption' }))).toHaveLength(2);
    expect(parseA2uiMessages(root({ weight: 600 }))).toHaveLength(2);
  });

  it('requires createSurface before a surface can be written into', () => {
    // Measured live: a model repeatedly sent ONLY `updateComponents`, the core
    // gate accepted it, and the official processor refused the batch
    // (`Surface not found for message: main`) so the card drew nothing. The
    // ordering is checkable here, so the refusal names the missing message.
    const orphan = explainA2uiMessages([
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [{ id: 'root', component: 'Text', text: 'x' }] } },
    ]);
    expect(orphan.messages).toBeUndefined();
    expect(orphan.reason).toContain('createSurface');
    expect(orphan.reason).toContain('main');

    // updateDataModel has the same precondition.
    expect(explainA2uiMessages([
      { version: '1.0', updateDataModel: { surfaceId: 'main', value: {} } },
    ]).reason).toContain('createSurface');

    // The ordered batch still passes, and so does a second message list that
    // reuses a surface created earlier in the SAME list.
    expect(parseA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [{ id: 'root', component: 'Text', text: 'x' }] } },
      { version: '1.0', updateDataModel: { surfaceId: 'main', value: {} } },
    ])).toHaveLength(3);
  });

  it('requires a Button action.event to name its event', () => {
    // Measured live: the model wrote `action: {event: {context: {...}}}` — an
    // event with a context but no `name`. The renderer's answer was
    // "Unrecognized key(s) in object: 'event'" (the strict union fails on every
    // arm), which points at neither the component nor the missing prop.
    const nameless = explainA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [
        { id: 'submit', component: 'Button', child: 'lbl', action: { event: { context: { v: { path: '/v' } } } } },
        { id: 'lbl', component: 'Text', text: '提交' },
      ] } },
    ]);
    expect(nameless.messages).toBeUndefined();
    expect(nameless.reason).toContain('submit');
    expect(nameless.reason).toContain('name');

    // The legal shape — and the functionCall arm — still pass.
    expect(parseA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [
        { id: 'submit', component: 'Button', child: 'lbl', action: { event: { name: 'submit', context: {} } } },
        { id: 'lbl', component: 'Text', text: '提交' },
      ] } },
    ])).toHaveLength(2);
  });

  it('refuses the v0.9 binding spelling that would paint an object', () => {
    // The published schema accepts BOTH `{"@path":…}` and `{"path":…}` (a
    // union), but web_core resolves them per protocol version: v1.0 only
    // honours `@path`, so a bare `path` binding survives validation and then
    // renders as the literal object — measured live as a TextField painting
    // "[object Object]". This product speaks v1.0 only.
    const bare = explainA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [
        { id: 'input', component: 'TextField', label: 'x', value: { path: '/v' } },
      ] } },
    ]);
    expect(bare.messages).toBeUndefined();
    expect(bare.reason).toContain('@path');
    expect(bare.reason).toContain('value');

    expect(parseA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [
        { id: 'input', component: 'TextField', label: 'x', value: { '@path': '/v' } },
      ] } },
    ])).toHaveLength(2);
  });

  it('names the component and the prop a refusal is about', () => {
    // A bare "invalid" is what made a live model repeat the same payload five
    // times. The reason has to identify the offender in its own vocabulary.
    const withVariant = (variant: string): unknown => [
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [
        { id: 'title', component: 'Text', text: 'x', variant },
      ] } },
    ];
    const heading = explainA2uiMessages(withVariant('h2'));
    expect(heading.messages).toBeUndefined();
    expect(heading.reason).toContain('title');
    expect(heading.reason).toContain('h2');

    const unknown = explainA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components: [{ id: 'root', component: 'FancyTable' }] } },
    ]);
    expect(unknown.reason).toContain('FancyTable');
  });

  it('caps the component table and the serialized payload', () => {
    const components = Array.from({ length: MAX_A2UI_COMPONENTS + 1 }, (_, index) => ({ id: `c${String(index)}`, component: 'Text', text: 'x' }));
    expect(parseA2uiMessages([
      create,
      { version: '1.0', updateComponents: { surfaceId: 'main', components } },
    ])).toBeUndefined();
  });
});
