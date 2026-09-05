import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDirFor, expandRefs, loadConfig, projectSlug, userConfigPath } from '../src/config.js';

describe('expandRefs', () => {
  it('expands {env:NAME} references', () => {
    process.env['NOVA_TEST_KEY'] = 'secret';
    expect(expandRefs('{env:NOVA_TEST_KEY}')).toBe('secret');
    expect(expandRefs('Bearer {env:NOVA_TEST_KEY}')).toBe('Bearer secret');
    expect(expandRefs('{env:NOVA_TEST_UNSET_XYZ}')).toBe('');
    delete process.env['NOVA_TEST_KEY'];
  });
});

describe('data dir resolution', () => {
  it('slugs projects by basename plus a path hash, stable across calls', () => {
    const home = path.join(tmpdir(), 'nova-home');
    const a = projectSlug('D:\\web\\agent', home);
    expect(a).toMatch(/^agent-[0-9a-f]{8}$/);
    expect(projectSlug('d:/web/agent/', home)).toBe(a); // case/separator/trailing slash normalized
    expect(projectSlug('D:\\web\\other\\agent', home)).not.toBe(a); // same basename, other path
    expect(dataDirFor('D:\\web\\agent', home)).toBe(path.join(home, '.nova', 'projects', a));
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
});
