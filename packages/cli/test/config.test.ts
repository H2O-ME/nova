import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandRefs, loadConfig, loadConfigWithDiagnostics, sessionDateBucket, sessionsRoot, userConfigPath } from '../src/config.js';

/**
 * The `clientSecret` an entry really carries, read through the same optional
 * chain the config type allows.
 *
 * A `?.[0]?.config as { … }` inline in an assertion is what lint rejects
 * (`no-unsafe-optional-chaining`): the chain can short-circuit to `undefined`
 * while the cast claims an object, so the property read throws instead of
 * failing the expectation. Reading it here says what to do in that case.
 */
function secretOf(entries: readonly { config?: unknown }[] | undefined): unknown {
  return (entries?.[0]?.config as { clientSecret?: unknown } | undefined)?.clientSecret;
}

describe('expandRefs', () => {
  it('expands {env:NAME} references', () => {
    process.env['NOVA_TEST_KEY'] = 'secret';
    expect(expandRefs('{env:NOVA_TEST_KEY}')).toBe('secret');
    expect(expandRefs('Bearer {env:NOVA_TEST_KEY}')).toBe('Bearer secret');
    delete process.env['NOVA_TEST_KEY'];
  });

  it('throws naming the missing variable when {env:NAME} is unset', () => {
    delete process.env['NOVA_TEST_UNSET_XYZ'];
    expect(() => expandRefs('{env:NOVA_TEST_UNSET_XYZ}')).toThrowError(
      /NOVA_TEST_UNSET_XYZ/,
    );
  });
});

describe('session storage layout', () => {
  it('buckets sessions by date under the global sessions root (codex-style)', () => {
    const home = path.join(tmpdir(), 'nova-home');
    expect(sessionsRoot(home)).toBe(path.join(home, '.nova', 'sessions'));
    const bucket = sessionDateBucket(new Date(2026, 8, 6, 14, 23, 5));
    expect(bucket).toBe('2026/09/06');
  });
});

describe('loadConfig', () => {
  /** Fresh fake home (~/.nova/config.json is the ONLY config location). */
  async function withConfig(raw: string | undefined): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), 'nova-home-'));
    if (raw !== undefined) {
      await mkdir(path.join(home, '.nova'), { recursive: true });
      await writeFile(userConfigPath(home), raw, 'utf8');
    }
    return home;
  }

  it('loads and validates ~/.nova/config.json', async () => {
    const home = await withConfig(
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' }, maxTurns: 3 }),
    );
    const config = await loadConfig(home);
    expect(config.provider?.model).toBe('m');
    expect(config.maxTurns).toBe(3);
  });

  it('expands env references during load', async () => {
    process.env['NOVA_TEST_KEY'] = 'sk-env';
    const home = await withConfig(
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: '{env:NOVA_TEST_KEY}', model: 'm' } }),
    );
    const config = await loadConfig(home);
    expect(config.provider?.apiKey).toBe('sk-env');
    delete process.env['NOVA_TEST_KEY'];
  });

  it('rejects a config missing provider fields', async () => {
    const home = await withConfig(JSON.stringify({ provider: {} }));
    await expect(loadConfig(home)).rejects.toThrow(/invalid config/);
  });

  // First run is a SUPPORTED empty shell, not an error: the operator has no
  // endpoint yet and the settings page is where they add one, so the loader must
  // hand back the defaults (with `provider` absent) instead of refusing to start.
  // A file that EXISTS but is malformed still throws — see the cases below.
  it('loads defaults when the config file does not exist yet', async () => {
    const home = await withConfig(undefined);
    const config = await loadConfig(home);
    expect(config.provider).toBeUndefined();
    // Every field is optional in the schema (the kernel supplies the defaults),
    // so the empty shell parses to a document with nothing in it.
    expect(config.approval).toBeUndefined();
  });

  it('names the file when its JSON is broken', async () => {
    const home = await withConfig('{ not json');
    await expect(loadConfig(home)).rejects.toThrow(/invalid JSON/);
  });

  it('accepts provider.contextWindow (context gauge denominator) and rejects junk', async () => {
    const home = await withConfig(
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm', contextWindow: 200000 } }),
    );
    const config = await loadConfig(home);
    expect(config.provider?.contextWindow).toBe(200000);
    const bad = await withConfig(
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm', contextWindow: 0 } }),
    );
    await expect(loadConfig(bad)).rejects.toThrow(/contextWindow/);
  });

  it('accepts a plugin row whose config is the plugin own schema business', async () => {
    const home = await withConfig(
      JSON.stringify({
        provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' },
        // The kernel does not validate inside `config`; the owning plugin's own
        // `Config` schema does, so any JSON shape is accepted here.
        plugins: { entries: [{ id: '@nova-agent/plugin-ptc', config: { mode: 'ptc', maxParallelSubCalls: 4 } }] },
      }),
    );
    const config = await loadConfig(home);
    expect(config.plugins?.entries?.[0]?.config).toEqual({ mode: 'ptc', maxParallelSubCalls: 4 });
  });

  it('rejects unknown keys, naming the offender (strict schema)', async () => {
    const home = await withConfig(
      JSON.stringify({
        provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' },
        apporval: 'full',
      }),
    );
    await expect(loadConfig(home)).rejects.toThrow(/apporval/);
  });

  it('rejects unknown NESTED keys too, naming the offender (strict at every level)', async () => {
    const provider = { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' };
    const badProvider = await withConfig(JSON.stringify({ provider: { ...provider, temprature: 0.5 } }));
    await expect(loadConfig(badProvider)).rejects.toThrow(/temprature/);
    // A deleted config table is now just an unknown key — that is what makes a
    // stale hand-written file fail loudly instead of being silently ignored.
    // (`tools` moved into the bash plugin's own row config; an old file still
    // carrying the table must be named, not absorbed.)
    const deletedTable = await withConfig(JSON.stringify({ provider, tools: { code: { mode: 'ptc' } } }));
    await expect(loadConfig(deletedTable)).rejects.toThrow(/tools/);
    const badRow = await withConfig(
      JSON.stringify({ provider, plugins: { entries: [{ id: 'todo', enable: false }] } }),
    );
    await expect(loadConfig(badRow)).rejects.toThrow(/enable/);
  });
});

/**
 * A plugin's own misconfiguration must not stop the product.
 *
 * Ownership is structural now: everything inside `plugins.entries[].config`
 * belongs to the plugin whose row it is, and a plugin is only started by the
 * invocations that ask for it. These tests pin BOTH halves of the rule — an
 * unresolved reference in a plugin row degrades to a diagnostic, while a core
 * section's reference still throws and names the variable.
 */
describe('plugin-owned config references', () => {
  async function withConfig(raw: string): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), 'nova-home-'));
    await mkdir(path.join(home, '.nova'), { recursive: true });
    await writeFile(userConfigPath(home), raw, 'utf8');
    return home;
  }

  const provider = { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' };
  const rowId = '@nova-agent/qqbot';

  it('starts anyway when only a plugin-row reference is unset, and reports it', async () => {
    delete process.env['NOVA_TEST_UNSET_SECRET'];
    const home = await withConfig(JSON.stringify({
      provider,
      plugins: { entries: [{ id: rowId, config: { appId: '1024', clientSecret: '{env:NOVA_TEST_UNSET_SECRET}' } }] },
    }));
    const { config, diagnostics } = await loadConfigWithDiagnostics(home);
    // The product came up: this is the whole point of the split.
    expect(config.provider?.model).toBe('m');
    expect(diagnostics).toEqual([{ section: rowId, variable: 'NOVA_TEST_UNSET_SECRET', pluginId: rowId }]);
    // The literal is LEFT AS WRITTEN rather than blanked to '': an empty
    // credential would reach the network and come back as a bare auth failure,
    // while the literal lets the owning plugin refuse it by name.
    expect(secretOf(config.plugins?.entries)).toBe('{env:NOVA_TEST_UNSET_SECRET}');
  });

  it('reports nothing once that variable is set', async () => {
    process.env['NOVA_TEST_SET_SECRET'] = 'real-secret';
    const home = await withConfig(JSON.stringify({
      provider,
      plugins: { entries: [{ id: rowId, config: { clientSecret: '{env:NOVA_TEST_SET_SECRET}' } }] },
    }));
    const { config, diagnostics } = await loadConfigWithDiagnostics(home);
    expect(diagnostics).toEqual([]);
    expect(secretOf(config.plugins?.entries)).toBe('real-secret');
    delete process.env['NOVA_TEST_SET_SECRET'];
  });

  it('reports one diagnostic per variable, not one per occurrence', async () => {
    delete process.env['NOVA_TEST_DUP_SECRET'];
    const home = await withConfig(JSON.stringify({
      provider,
      // Two references to the same variable inside one row: one problem.
      plugins: {
        entries: [{ id: rowId, config: { appId: '{env:NOVA_TEST_DUP_SECRET}', clientSecret: '{env:NOVA_TEST_DUP_SECRET}' } }],
      },
    }));
    const { diagnostics } = await loadConfigWithDiagnostics(home);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.variable).toBe('NOVA_TEST_DUP_SECRET');
  });

  it('STILL refuses to load when a CORE reference is unset', async () => {
    // The counterweight: widening the rule must not make the loud failure go
    // away where it is right. A provider credential no surface can work without
    // is not a diagnostic.
    delete process.env['NOVA_TEST_UNSET_KEY'];
    const home = await withConfig(JSON.stringify({
      provider: { ...provider, apiKey: '{env:NOVA_TEST_UNSET_KEY}' },
    }));
    await expect(loadConfig(home)).rejects.toThrow(/NOVA_TEST_UNSET_KEY/);
  });

  it('keeps a mixed document working when only the plugin row is unset', async () => {
    delete process.env['NOVA_TEST_UNSET_SECRET'];
    process.env['NOVA_TEST_MIXED_KEY'] = 'sk-live';
    const home = await withConfig(JSON.stringify({
      provider: { ...provider, apiKey: '{env:NOVA_TEST_MIXED_KEY}' },
      plugins: { entries: [{ id: rowId, config: { clientSecret: '{env:NOVA_TEST_UNSET_SECRET}' } }] },
    }));
    const { config, diagnostics } = await loadConfigWithDiagnostics(home);
    // The core half expanded normally even though a plugin row could not.
    expect(config.provider?.apiKey).toBe('sk-live');
    expect(diagnostics).toHaveLength(1);
    delete process.env['NOVA_TEST_MIXED_KEY'];
  });

  it('keeps loadConfig (no diagnostics) a drop-in for callers that cannot show them', async () => {
    delete process.env['NOVA_TEST_UNSET_SECRET'];
    const home = await withConfig(JSON.stringify({
      provider,
      plugins: { entries: [{ id: rowId, config: { appId: '1024', clientSecret: '{env:NOVA_TEST_UNSET_SECRET}' } }] },
    }));
    const config = await loadConfig(home);
    expect(config.plugins?.entries?.[0]?.id).toBe(rowId);
  });
});
