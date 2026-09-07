import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandRefs, loadConfig, sessionDateBucket, sessionsRoot, userConfigPath } from '../src/config.js';

describe('expandRefs', () => {
  it('expands {env:NAME} references', () => {
    process.env['NOVA_TEST_KEY'] = 'secret';
    expect(expandRefs('{env:NOVA_TEST_KEY}')).toBe('secret');
    expect(expandRefs('Bearer {env:NOVA_TEST_KEY}')).toBe('Bearer secret');
    expect(expandRefs('{env:NOVA_TEST_UNSET_XYZ}')).toBe('');
    delete process.env['NOVA_TEST_KEY'];
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

  it('gives a helpful error when the config file is missing', async () => {
    const home = await withConfig(undefined);
    await expect(loadConfig(home)).rejects.toThrow(/missing config[\s\S]*config\.json/);
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

  it('accepts provider.contextWindow (TUI bar denominator) and rejects junk', async () => {
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
});
