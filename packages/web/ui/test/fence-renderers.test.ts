/**
 * The fence renderer registry is the seam a plugin-owned UI capability plugs
 * into. Killing tests: registering a renderer must take precedence over the
 * stock code card, returning null must fall through, and unregistered fences
 * must produce `undefined` (the markdown layer keeps its existing branch).
 */
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  fenceRendererFor,
  registerFenceRenderer,
  unregisterFenceRenderer,
} from '../src/chat/markdown/fence-renderers.js';

describe('fence renderer registry', () => {
  it('returns undefined when nothing is registered for the language', () => {
    expect(fenceRendererFor(undefined)).toBeUndefined();
    expect(fenceRendererFor('dsh-ui')).toBeUndefined();
  });

  it('dispatches a registered renderer and ignores casing on lookup', () => {
    const render = (): ReturnType<typeof createElement> => createElement('div', null, 'genui');
    registerFenceRenderer('dsh-ui', render);
    try {
      expect(fenceRendererFor('dsh-ui')).toBe(render);
      // The markdown parser lowercases the info string; the registry contract
      // keeps the same normalization on lookup so a plugin registering `DSH-UI`
      // still hits.
      expect(fenceRendererFor('DSH-UI')).toBe(render);
    } finally {
      unregisterFenceRenderer('dsh-ui');
    }
    expect(fenceRendererFor('dsh-ui')).toBeUndefined();
  });

  it('replaces an existing renderer so the latest registration wins', () => {
    const first = (): ReturnType<typeof createElement> => createElement('span');
    const second = (): ReturnType<typeof createElement> => createElement('p');
    registerFenceRenderer('nov-ui', first);
    registerFenceRenderer('nov-ui', second);
    try {
      expect(fenceRendererFor('nov-ui')).toBe(second);
    } finally {
      unregisterFenceRenderer('nov-ui');
    }
  });

  it('ignores an empty language tag at registration time', () => {
    const render = (): ReturnType<typeof createElement> => createElement('div');
    registerFenceRenderer('', render);
    expect(fenceRendererFor('')).toBeUndefined();
  });
});
