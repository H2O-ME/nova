import { describe, expect, it } from 'vitest';
import type { A2uiMessage } from '@nova-agent/core';
import { actionOf, buildSurfaces, getAtPath, resolveValue, setAtPath, templateRows } from '../src/a2ui/surface.js';

const messages: readonly A2uiMessage[] = [
  { version: '1.0', createSurface: { surfaceId: 'main', dataModel: { email: 'a@b', tags: ['x', 'y'] } } },
  {
    version: '1.0',
    updateComponents: {
      surfaceId: 'main',
      components: [
        { id: 'root', component: 'Column', children: ['field'] },
        { id: 'field', component: 'TextField', label: 'Email', value: { path: '/email' } },
        {
          id: 'send',
          component: 'Button',
          child: 'sendLabel',
          action: { event: { name: 'submit', context: { email: { path: '/email' } } } },
        },
        { id: 'sendLabel', component: 'Text', text: 'Send' },
      ],
    },
  },
];

describe('A2UI surface model', () => {
  it('folds messages into one component table and one data model', () => {
    const [surface] = buildSurfaces(messages);
    expect(surface?.id).toBe('main');
    expect(surface?.components.get('field')?.component).toBe('TextField');
    expect(getAtPath(surface?.data, '/email')).toBe('a@b');
  });

  it('resolves bound values and button actions against the CURRENT model', () => {
    const [surface] = buildSurfaces(messages);
    const updated = setAtPath(surface?.data, '/email', 'me@new');
    expect(resolveValue({ path: '/email' }, updated)).toBe('me@new');
    const action = actionOf(surface!.components.get('send')!, updated);
    expect(action).toEqual({ name: 'submit', context: { email: 'me@new' } });
  });

  it('expands a List template over an array without mutating the model', () => {
    const list = { id: 'root', component: 'List', children: { path: '/tags', componentId: 'tag' } };
    const rows = templateRows(list, { tags: [{ label: 'a' }, { label: 'b' }] });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.scope).toEqual({ label: 'b' });
    expect(resolveValue({ path: 'label' }, { tags: [] }, rows[1]?.scope)).toBe('b');
  });
});
