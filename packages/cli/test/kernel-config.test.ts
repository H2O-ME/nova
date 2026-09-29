/**
 * `toKernelConfig` — the config document's SECOND DOORS onto an advanced plugin.
 *
 * `ptc` has two: `plugins.enable`, and a non-`native` `tools.code.mode`. `qqbot`
 * has two: `plugins.enable`, and the presence of a `qqbot` config block. The
 * derivations exist so a config written before the tier table existed keeps
 * starting the plugin it used to start — but a derivation that outvotes
 * `plugins.disable` is what made a switched-off plugin come back: the row read
 * OFF and the next boot put it back. Each case below is one half of that: a
 * disabled row stays disabled, and an untouched config still opts in.
 */
import { describe, expect, it } from 'vitest';
import { toKernelConfig } from '../src/kernel-config.js';
import type { Config } from '../src/config.js';

const QQ = { appId: '12345', clientSecret: 'shh' };

describe('toKernelConfig · derived opt-ins', () => {
  it('lets `disable` beat the code mode: ptc stays off and the mode goes back to native', () => {
    // The reported defect: turning the PTC row off left `tools.code.mode: "ptc"`
    // in the file, so the next boot showed PTC selected in settings while the row
    // that owns it read OFF — and the derived `enable` entry fought the switch.
    const config: Config = { tools: { code: { mode: 'ptc' } }, plugins: { disable: ['ptc'] } };
    const kernel = toKernelConfig(config);
    expect(kernel.plugins?.enable ?? []).not.toContain('ptc');
    // The mode is projected to `native` rather than rewritten: the kernel never
    // runs a mode whose plugin is not loaded, and the file keeps the operator's
    // own value for the moment they switch the row back on.
    expect(kernel.code?.mode).toBe('native');
  });

  it('still derives ptc from a non-native code mode when nothing is switched off', () => {
    const kernel = toKernelConfig({ tools: { code: { mode: 'both' } } });
    expect(kernel.plugins?.enable).toContain('ptc');
    expect(kernel.code?.mode).toBe('both');
  });

  it('lets `disable` beat the qqbot block', () => {
    const kernel = toKernelConfig({ qqbot: QQ, plugins: { disable: ['qqbot'] } });
    expect(kernel.plugins?.enable ?? []).not.toContain('qqbot');
  });

  it('still derives qqbot from a stored credential block', () => {
    const kernel = toKernelConfig({ qqbot: QQ });
    expect(kernel.plugins?.enable).toContain('qqbot');
  });

  it('merges the derived names into the operator own enable list', () => {
    // The derivation must not REPLACE the list: an operator who opted into
    // `subagent` would silently lose it on every boot.
    const kernel = toKernelConfig({
      tools: { code: { mode: 'ptc' } },
      plugins: { enable: ['subagent'], disable: ['qqbot'] },
      qqbot: QQ,
    });
    expect(kernel.plugins?.enable).toEqual(['subagent', 'ptc']);
  });
});
