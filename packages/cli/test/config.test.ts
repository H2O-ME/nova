import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandRefs, loadConfig, loadConfigWithDiagnostics, sessionDateBucket, sessionsRoot, userConfigPath } from '../src/config.js';
import { qqBotConfigProblem } from '../src/config-read.js';
import { saveQqBotConfig } from '../src/config-write.js';

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
    expect(config.provider.model).toBe('m');
    expect(config.maxTurns).toBe(3);
  });

  it('expands env references during load', async () => {
    process.env['NOVA_TEST_KEY'] = 'sk-env';
    const home = await withConfig(
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: '{env:NOVA_TEST_KEY}', model: 'm' } }),
    );
    const config = await loadConfig(home);
    expect(config.provider.apiKey).toBe('sk-env');
    delete process.env['NOVA_TEST_KEY'];
  });

  it('rejects a config missing provider fields', async () => {
    const home = await withConfig(JSON.stringify({ provider: {} }));
    await expect(loadConfig(home)).rejects.toThrow(/invalid config/);
  });

  // First run is a SUPPORTED empty shell, not an error: the operator has no
  // endpoint yet and the settings page is where they add one, so the loader must
  // hand back the defaults (with `provider` absent) instead of refusing to start.
  // A file that EXISTS but is malformed still throws — see the two cases below.
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

  it('accepts tools.code (PTC mode) settings and rejects invalid ones', async () => {
    const provider = { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' };
    const home = await withConfig(
      JSON.stringify({ provider, tools: { code: { mode: 'ptc', maxParallelSubCalls: 4, computeMs: 5000, maxOutputBytes: 65536 } } }),
    );
    const config = await loadConfig(home);
    expect(config.tools?.code?.mode).toBe('ptc');
    expect(config.tools?.code?.maxParallelSubCalls).toBe(4);
    expect(config.tools?.code?.computeMs).toBe(5000);
    const bad = await withConfig(JSON.stringify({ provider, tools: { code: { mode: 'code-first' } } }));
    await expect(loadConfig(bad)).rejects.toThrow(/mode/);
  });

  it('accepts provider.contextWindow (context gauge denominator) and rejects junk', async () => {
    const home = await withConfig(
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm', contextWindow: 200000 } }),
    );
    const config = await loadConfig(home);
    expect(config.provider.contextWindow).toBe(200000);
    const bad = await withConfig(
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm', contextWindow: 0 } }),
    );
    await expect(loadConfig(bad)).rejects.toThrow(/contextWindow/);
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
});

/**
 * A plugin's own misconfiguration must not stop the product.
 *
 * `qqbot` belongs to the third-party channel plugin: its credentials are needed
 * by `nova qqbot` and by nothing else. Expanding every reference at load meant
 * an unset `{env:QQ_SECRET}` blocked the browser UI, the REPL and `exec` — the
 * reported symptom was `nova` refusing to start with a bare sentence about a
 * variable those surfaces never read. These tests pin BOTH halves of the rule:
 * a plugin-owned section degrades to a diagnostic, a core section still throws.
 */
describe('plugin-owned config references', () => {
  async function withConfig(raw: string): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), 'nova-home-'));
    await mkdir(path.join(home, '.nova'), { recursive: true });
    await writeFile(userConfigPath(home), raw, 'utf8');
    return home;
  }

  const provider = { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' };

  it('starts anyway when only a plugin-owned reference is unset, and reports it', async () => {
    delete process.env['NOVA_TEST_UNSET_SECRET'];
    const home = await withConfig(JSON.stringify({
      provider,
      qqbot: { appId: '1024', clientSecret: '{env:NOVA_TEST_UNSET_SECRET}' },
    }));
    const { config, diagnostics } = await loadConfigWithDiagnostics(home);
    // The product came up: this is the whole point of the split.
    expect(config.provider.model).toBe('m');
    expect(diagnostics).toEqual([{ section: 'qqbot', variable: 'NOVA_TEST_UNSET_SECRET' }]);
    // The literal is LEFT AS WRITTEN rather than blanked to '': an empty
    // credential would reach the network and come back as a bare auth failure,
    // while the literal lets the owning plugin refuse it by name.
    expect(config.qqbot?.clientSecret).toBe('{env:NOVA_TEST_UNSET_SECRET}');
  });

  it('still reports nothing once that variable is set', async () => {
    process.env['NOVA_TEST_SET_SECRET'] = 'real-secret';
    const home = await withConfig(JSON.stringify({
      provider,
      qqbot: { appId: '1024', clientSecret: '{env:NOVA_TEST_SET_SECRET}' },
    }));
    const { config, diagnostics } = await loadConfigWithDiagnostics(home);
    expect(diagnostics).toEqual([]);
    expect(config.qqbot?.clientSecret).toBe('real-secret');
    delete process.env['NOVA_TEST_SET_SECRET'];
  });

  it('reports one diagnostic per variable, not one per occurrence', async () => {
    delete process.env['NOVA_TEST_DUP_SECRET'];
    const home = await withConfig(JSON.stringify({
      provider,
      // A value and a nested one both naming the same variable: one problem.
      qqbot: { appId: '{env:NOVA_TEST_DUP_SECRET}', clientSecret: '{env:NOVA_TEST_DUP_SECRET}' },
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

  it('keeps a mixed document working when only the plugin half is unset', async () => {
    delete process.env['NOVA_TEST_UNSET_SECRET'];
    process.env['NOVA_TEST_MIXED_KEY'] = 'sk-live';
    const home = await withConfig(JSON.stringify({
      provider: { ...provider, apiKey: '{env:NOVA_TEST_MIXED_KEY}' },
      qqbot: { appId: '1024', clientSecret: '{env:NOVA_TEST_UNSET_SECRET}' },
    }));
    const { config, diagnostics } = await loadConfigWithDiagnostics(home);
    // The core half expanded normally even though another section could not.
    expect(config.provider.apiKey).toBe('sk-live');
    expect(diagnostics).toHaveLength(1);
    delete process.env['NOVA_TEST_MIXED_KEY'];
  });

  it('keeps loadConfig (no diagnostics) a drop-in for callers that cannot show them', async () => {
    delete process.env['NOVA_TEST_UNSET_SECRET'];
    const home = await withConfig(JSON.stringify({
      provider,
      qqbot: { appId: '1024', clientSecret: '{env:NOVA_TEST_UNSET_SECRET}' },
    }));
    const config = await loadConfig(home);
    expect(config.qqbot?.appId).toBe('1024');
  });
});

describe('qqBotConfigProblem', () => {
  async function withConfig(raw: string): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), 'nova-home-'));
    await mkdir(path.join(home, '.nova'), { recursive: true });
    await writeFile(userConfigPath(home), raw, 'utf8');
    return home;
  }

  const provider = { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' };

  it('names the field and the variable when a stored reference is unset', async () => {
    delete process.env['NOVA_TEST_UNSET_SECRET'];
    const home = await withConfig(JSON.stringify({
      provider,
      qqbot: { appId: '1024', clientSecret: '{env:NOVA_TEST_UNSET_SECRET}' },
    }));
    const problem = await qqBotConfigProblem(home);
    // Both halves matter: WHICH field to edit, and WHICH variable to set.
    expect(problem).toMatch(/qqbot\.clientSecret/u);
    expect(problem).toMatch(/NOVA_TEST_UNSET_SECRET/u);
  });

  it('says nothing when the stored credentials are usable', async () => {
    const home = await withConfig(JSON.stringify({ provider, qqbot: { appId: '1024', clientSecret: 'literal' } }));
    await expect(qqBotConfigProblem(home)).resolves.toBeUndefined();
  });

  it('says nothing when there is no qqbot block at all', async () => {
    // Not-configured is the page's empty state, not a problem to report.
    const home = await withConfig(JSON.stringify({ provider }));
    await expect(qqBotConfigProblem(home)).resolves.toBeUndefined();
  });

  it('says nothing when there is no config file to read', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'nova-home-'));
    await expect(qqBotConfigProblem(home)).resolves.toBeUndefined();
  });

  it('answers from DISK, so a save is reflected without a reload', async () => {
    delete process.env['NOVA_TEST_UNSET_SECRET'];
    const home = await withConfig(JSON.stringify({
      provider,
      qqbot: { appId: '1024', clientSecret: '{env:NOVA_TEST_UNSET_SECRET}' },
    }));
    expect(await qqBotConfigProblem(home)).toBeDefined();
    // The operator pasted a real secret: the verdict must follow the file, not
    // the boot-time snapshot the process is still holding.
    await saveQqBotConfig({ appId: '1024', clientSecret: 'now-a-literal' }, home);
    await expect(qqBotConfigProblem(home)).resolves.toBeUndefined();
  });
});
