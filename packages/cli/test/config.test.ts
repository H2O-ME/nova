import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandRefs, findRootDir, loadConfig } from '../src/config.js';

describe('findRootDir', () => {
  it('walks up from a nested directory to the workspace root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-root-'));
    const nested = path.join(root, 'a', 'b');
    await mkdir(path.join(root, '.nova'), { recursive: true });
    await writeFile(
      path.join(root, '.nova', 'config.json'),
      JSON.stringify({ provider: { baseURL: 'u', apiKey: 'k', model: 'm' } }),
      'utf8',
    );
    await mkdir(nested, { recursive: true });
    expect(await findRootDir(nested)).toBe(root);
  });

  it('returns the start directory when no config exists anywhere above', async () => {
    const start = await mkdtemp(path.join(tmpdir(), 'nova-none-'));
    expect(await findRootDir(start)).toBe(start);
  });
});

describe('expandRefs', () => {
  it('expands {env:NAME} references', () => {
    process.env['NOVA_TEST_KEY'] = 'secret';
    expect(expandRefs('{env:NOVA_TEST_KEY}')).toBe('secret');
    expect(expandRefs('Bearer {env:NOVA_TEST_KEY}')).toBe('Bearer secret');
    expect(expandRefs('{env:NOVA_TEST_UNSET_XYZ}')).toBe('');
    delete process.env['NOVA_TEST_KEY'];
  });
});

describe('loadConfig', () => {
  it('loads and validates a config file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-cfg-'));
    await mkdir(path.join(root, '.nova'), { recursive: true });
    await writeFile(
      path.join(root, '.nova', 'config.json'),
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-1', model: 'm' }, maxTurns: 3 }),
      'utf8',
    );
    const config = await loadConfig(root);
    expect(config.provider.model).toBe('m');
    expect(config.maxTurns).toBe(3);
  });

  it('expands env references during load', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-cfg-'));
    await mkdir(path.join(root, '.nova'), { recursive: true });
    process.env['NOVA_TEST_KEY'] = 'sk-env';
    await writeFile(
      path.join(root, '.nova', 'config.json'),
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: '{env:NOVA_TEST_KEY}', model: 'm' } }),
      'utf8',
    );
    const config = await loadConfig(root);
    expect(config.provider.apiKey).toBe('sk-env');
    delete process.env['NOVA_TEST_KEY'];
  });

  it('rejects a config missing provider fields', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-cfg-'));
    await mkdir(path.join(root, '.nova'), { recursive: true });
    await writeFile(path.join(root, '.nova', 'config.json'), JSON.stringify({ provider: {} }), 'utf8');
    await expect(loadConfig(root)).rejects.toThrow(/invalid config/);
  });

  it('gives a helpful error when config is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-cfg-'));
    await expect(loadConfig(root)).rejects.toThrow(/missing config/);
  });
});
