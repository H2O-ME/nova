/**
 * `toKernelConfig` — the config document's path INTO the plugin tree.
 *
 * It is a pass-through now. The old version projected two "second doors" onto an
 * advanced plugin (`tools.code.mode` → `ptc`, a `qqbot` block → `qqbot`) and
 * merged them into `plugins.enable`, which is exactly how a switched-off plugin
 * came back on the next boot: the row read OFF and the derivation put it back.
 * The single switch is the row, so the only thing left to pin is that the row
 * arrives at the kernel verbatim.
 */
import { describe, expect, it } from 'vitest';
import { toKernelConfig } from '../src/kernel-config.js';
import type { Config } from '../src/config.js';

describe('toKernelConfig · plugin rows are the only switch', () => {
  it('carries a row through verbatim, config and all', () => {
    const config: Config = {
      plugins: { entries: [{ id: '@nova-agent/plugin-ptc', enabled: false, config: { mode: 'ptc' } }] },
    };
    // Verbatim IS the contract: nothing here reads `config.mode` and nothing
    // consults the row's id, so no derivation can outvote the switch.
    expect(toKernelConfig(config).plugins).toEqual({
      entries: [{ id: '@nova-agent/plugin-ptc', enabled: false, config: { mode: 'ptc' } }],
    });
  });

  it('an enabled row is how an advanced plugin is opted into', () => {
    const kernel = toKernelConfig({ plugins: { entries: [{ id: 'subagent', enabled: true }] } });
    expect(kernel.plugins?.entries).toEqual([{ id: 'subagent', enabled: true }]);
  });

  it('says nothing about plugins the operator wrote no row for', () => {
    // Absence is what "as the plugin ships" means — the tree applies each
    // plugin's own tier default, and this projection must not invent a row.
    expect(toKernelConfig({}).plugins).toBeUndefined();
    expect(toKernelConfig({ plugins: {} }).plugins).toEqual({ entries: [] });
  });
});
