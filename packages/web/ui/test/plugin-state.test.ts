/**
 * The plugin roster's state readings. The wire carries the container's own
 * `FiberState` names; the settings row must never print them verbatim, which is
 * a mapping rather than a rendering concern — so it is asserted without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { pluginStateLabel } from '../src/settings/plugin-state.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';

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
