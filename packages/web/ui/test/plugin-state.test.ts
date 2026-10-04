/**
 * The plugin roster's state readings. The wire carries the container's own
 * `FiberState` names; the settings row must never print them verbatim, which is
 * a mapping rather than a rendering concern — so it is asserted without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { pagePlugins, pluginStateLabel } from '../src/settings/plugin-state.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';
import type { WireRosterEntry } from '../../src/roster-entry.js';

describe('pluginStateLabel', () => {
  it('reads every phase of the container state machine in the reader\'s words', () => {
    // `core/plugin/fiber.ts`: pending -> loading -> active -> disposed, with
    // failed as the other terminal state.
    expect(pluginStateLabel('pending')).toBe(SETTINGS_COPY['pluginState.pending']);
    expect(pluginStateLabel('loading')).toBe(SETTINGS_COPY['pluginState.loading']);
    expect(pluginStateLabel('active')).toBe(SETTINGS_COPY['pluginState.active']);
    expect(pluginStateLabel('failed')).toBe(SETTINGS_COPY['pluginState.failed']);
    expect(pluginStateLabel('disposed')).toBe(SETTINGS_COPY['pluginState.disposed']);
  });

  it('falls back to the wire value for a state this build does not know', () => {
    // Hiding an unrecognized phase would leave an empty cell where a fact was.
    expect(pluginStateLabel('quiescing')).toBe('quiescing');
  });

  it('never returns an Object.prototype member for a hostile state', () => {
    // Same defect as the context tag: the table is an object literal and the
    // phase arrives off the wire, so `constructor` would resolve to a function
    // and reach React as a child.
    for (const state of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(pluginStateLabel(state)).toBe(state);
    }
  });
});

describe('pagePlugins', () => {
  /** One roster row, shaped like the wire's (the nav draws exactly these). */
  const row = (name: string, over: Partial<WireRosterEntry> = {}): WireRosterEntry => ({
    name, state: 'active', inject: [], ...over,
  });

  it('keeps a page-owning row that is not switched off', () => {
    // `enabled` ABSENT counts as on — the same `?? true` reading the manager's
    // switch draws from, so a host that omits the flag still gets its page.
    expect(pagePlugins([row('a', { page: true })])).toHaveLength(1);
  });

  it('drops a row whose page belongs to a plugin that is switched off', () => {
    // The row itself stays in the manager's list (the page must reappear when it
    // is switched back on); only the NAVIGATION loses the section.
    expect(pagePlugins([row('a', { page: true, enabled: false })])).toEqual([]);
  });

  it('drops a page whose plugin is enabled but has no live fiber to answer it', () => {
    // The `apply()`-threw shape: the operator opened the row, so `enabled` is the
    // FACT `true` — and the fiber settled on `failed`, so nothing registered the
    // `pluginRpc` namespace that answers `page`. Offering the section drew a page
    // the product could only ever answer with `no loaded plugin answers`.
    expect(pagePlugins([row('a', { page: true, enabled: true, state: 'failed' })])).toEqual([]);
    // Same criterion, the other phases that have no answering fiber either:
    // `pending` / `loading` have not run `apply` yet, `disposed` was torn down.
    for (const state of ['pending', 'loading', 'disposed', 'quiescing']) {
      expect(pagePlugins([row('a', { page: true, state })])).toEqual([]);
    }
    // The module-load-failure shape (`enabled: false`, `state: 'failed'`) is one
    // of the two above; asserting it here keeps whichever half drops it honest.
    expect(pagePlugins([row('a', { page: true, enabled: false, state: 'failed' })])).toEqual([]);
    // ...and liveness is what is being asked for, not "some state was reported":
    // a row that is on and active is still offered.
    expect(pagePlugins([row('a', { page: true, enabled: true, state: 'active' })])).toHaveLength(1);
  });

  it('drops a row that declares no page', () => {
    expect(pagePlugins([row('a')])).toEqual([]);
  });
});
