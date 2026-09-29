/**
 * The config writers a running surface owns: the model seat, the plugin and
 * skill switches, and the qqbot connection block.
 *
 * The load path expands `{env:NAME}`, so these tests pin the property that
 * makes every write safe — they edit the raw document, never the loaded object.
 * A regression here does not fail loudly; it silently replaces a secret
 * reference with the secret.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { userConfigPath } from '@nova-agent/core';
import {
  saveModelChoice,
  saveQqBotConfig,
  setPluginEnabled,
  setSkillEnabled,
} from '../src/config-write.js';
import { readQqBotSecretRef } from '../src/config-read.js';

/** A fake home holding `raw` at ~/.nova/config.json. */
async function withConfig(raw: string): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-cfg-'));
  await mkdir(path.join(home, '.nova'), { recursive: true });
  await writeFile(userConfigPath(home), raw, 'utf8');
  return home;
}

describe('saveModelChoice', () => {
  it('rewrites provider.model and leaves every other field alone', async () => {
    const home = await withConfig(
      JSON.stringify({
        provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'old' },
        maxTurns: 3,
        ui: { theme: 'dark' },
      }),
    );
    await saveModelChoice('new-model', home);
    const doc = JSON.parse(await readFile(userConfigPath(home), 'utf8')) as Record<string, unknown>;
    expect(doc['provider']).toMatchObject({ model: 'new-model', apiKey: 'sk-literal' });
    expect(doc['maxTurns']).toBe(3);
    expect(doc['ui']).toEqual({ theme: 'dark' });
  });

  it('keeps a {env:NAME} reference a reference instead of writing the secret', async () => {
    process.env['NOVA_CFG_TEST_KEY'] = 'sk-super-secret';
    try {
      const home = await withConfig(
        JSON.stringify({
          provider: { baseURL: 'https://x.test/v1', apiKey: '{env:NOVA_CFG_TEST_KEY}', model: 'old' },
        }),
      );
      await saveModelChoice('next', home);
      const text = await readFile(userConfigPath(home), 'utf8');
      // The whole reason this patches raw text: the loaded Config has the
      // expanded secret in apiKey, so a round-trip through it would persist
      // the credential itself into a file the user expects to be shareable.
      expect(text).toContain('{env:NOVA_CFG_TEST_KEY}');
      expect(text).not.toContain('sk-super-secret');
    } finally {
      delete process.env['NOVA_CFG_TEST_KEY'];
    }
  });

  it('leaves the previous config in place when the document has no provider', async () => {
    const raw = JSON.stringify({ maxTurns: 1 });
    const home = await withConfig(raw);
    await expect(saveModelChoice('m', home)).rejects.toThrowError(/provider/);
    expect(await readFile(userConfigPath(home), 'utf8')).toBe(raw);
  });
});

describe('setPluginEnabled / setSkillEnabled', () => {
  /** The `disable` list under `key` in the file at `home`. */
  async function disableList(home: string, key: string): Promise<unknown> {
    const doc = JSON.parse(await readFile(userConfigPath(home), 'utf8')) as Record<string, unknown>;
    return (doc[key] as Record<string, unknown> | undefined)?.['disable'];
  }

  it('adds a name on disable, removes it on enable, and returns the list in force', async () => {
    const home = await withConfig(JSON.stringify({ provider: { model: 'm' } }));
    expect(await setPluginEnabled('subagent', false, home)).toEqual(['subagent']);
    expect(await disableList(home, 'plugins')).toEqual(['subagent']);
    expect(await setPluginEnabled('subagent', true, home)).toEqual([]);
    expect(await disableList(home, 'plugins')).toEqual([]);
  });

  it('keeps the list sorted and de-duplicated across repeated flips', async () => {
    const home = await withConfig(JSON.stringify({ provider: { model: 'm' } }));
    for (const name of ['todo', 'subagent', 'todo', 'ask-user']) {
      await setPluginEnabled(name, false, home);
    }
    // Two `todo` disables collapse to one entry, and the list reads in order —
    // the file stays reviewable after a session of clicking switches.
    expect(await disableList(home, 'plugins')).toEqual(['ask-user', 'subagent', 'todo']);
  });

  it('never touches plugins.extra while writing plugins.disable', async () => {
    const home = await withConfig(
      JSON.stringify({ provider: { model: 'm' }, plugins: { extra: ['./mine.mjs'] } }),
    );
    await setPluginEnabled('todo', false, home);
    const doc = JSON.parse(await readFile(userConfigPath(home), 'utf8')) as Record<string, unknown>;
    // `extra` is the extension point; a disable flip must not consume it.
    expect(doc['plugins']).toEqual({ extra: ['./mine.mjs'], disable: ['todo'] });
  });

  it('leaves every other field, and a sibling reference, byte-identical', async () => {
    process.env['NOVA_CFG_TEST_QQ'] = 'the-real-secret';
    try {
      const home = await withConfig(
        JSON.stringify({
          provider: { baseURL: 'https://x.test/v1', apiKey: '{env:NOVA_CFG_TEST_QQ}', model: 'm' },
          maxTurns: 7,
        }),
      );
      await setSkillEnabled('deep-research', false, home);
      const text = await readFile(userConfigPath(home), 'utf8');
      expect(text).toContain('{env:NOVA_CFG_TEST_QQ}');
      expect(text).not.toContain('the-real-secret');
      const doc = JSON.parse(text) as Record<string, unknown>;
      expect(doc['maxTurns']).toBe(7);
      expect(await disableList(home, 'skills')).toEqual(['deep-research']);
    } finally {
      delete process.env['NOVA_CFG_TEST_QQ'];
    }
  });

  it('creates the plugins/skills object when the file has none', async () => {
    const home = await withConfig(JSON.stringify({ provider: { model: 'm' } }));
    await setPluginEnabled('todo', false, home);
    await setSkillEnabled('pdf', false, home);
    expect(await disableList(home, 'plugins')).toEqual(['todo']);
    expect(await disableList(home, 'skills')).toEqual(['pdf']);
  });

  it('refuses to rewrite a config it cannot parse, and leaves the text alone', async () => {
    const raw = '{ this is not json';
    const home = await withConfig(raw);
    await expect(setPluginEnabled('todo', false, home)).rejects.toThrowError(/invalid JSON/u);
    // The whole point of aborting: a document the process cannot understand is
    // one it must not silently overwrite.
    expect(await readFile(userConfigPath(home), 'utf8')).toBe(raw);
  });

  it('refuses a non-object root rather than discarding it', async () => {
    const raw = '[1,2,3]';
    const home = await withConfig(raw);
    await expect(setPluginEnabled('todo', false, home)).rejects.toThrowError(/JSON object/u);
    expect(await readFile(userConfigPath(home), 'utf8')).toBe(raw);
  });
});

describe('saveQqBotConfig / readQqBotSecretRef', () => {
  it('stores the block and leaves an undefined field alone', async () => {
    const home = await withConfig(JSON.stringify({ provider: { model: 'm' } }));
    await saveQqBotConfig({ appId: '1024', clientSecret: 'sekret' }, home);
    // A later "appId only" save (the panel's test-only path) must not blank the
    // credential the operator kept.
    await saveQqBotConfig({ appId: '2048' }, home);
    const doc = JSON.parse(await readFile(userConfigPath(home), 'utf8')) as Record<string, unknown>;
    expect(doc['qqbot']).toEqual({ appId: '2048', clientSecret: 'sekret' });
  });

  it('stores an {env:NAME} value verbatim, as the load path expects a reference', async () => {
    const home = await withConfig(JSON.stringify({ provider: { model: 'm' } }));
    await saveQqBotConfig({ appId: '1024', clientSecret: '{env:QQ_SECRET}' }, home);
    const text = await readFile(userConfigPath(home), 'utf8');
    // Verbatim: the field means "read this variable", so the panel must not be
    // able to have its input expanded on the way to disk.
    expect(text).toContain('{env:QQ_SECRET}');
  });

  it('reports the variable name a stored reference reads from', async () => {
    const home = await withConfig(
      JSON.stringify({ provider: { model: 'm' }, qqbot: { appId: '1', clientSecret: '{env:QQ_SECRET}' } }),
    );
    expect(await readQqBotSecretRef(home)).toBe('QQ_SECRET');
  });

  it('reports nothing for a literal secret — there is no variable to name', async () => {
    const home = await withConfig(
      JSON.stringify({ provider: { model: 'm' }, qqbot: { appId: '1', clientSecret: 'sk-plain' } }),
    );
    // The regression this pins: this used to be derived from the LOADED config,
    // which `loadConfig` had already run through `expandDeep` — so a reference
    // had become the secret by then and this returned undefined for BOTH cases,
    // leaving the panel unable to tell "read from env" from "written in the file".
    expect(await readQqBotSecretRef(home)).toBeUndefined();
  });

  it('reports nothing when there is no qqbot block or no file', async () => {
    const home = await withConfig(JSON.stringify({ provider: { model: 'm' } }));
    expect(await readQqBotSecretRef(home)).toBeUndefined();
    const missing = await mkdtemp(path.join(tmpdir(), 'nova-cfg-none-'));
    await expect(readQqBotSecretRef(missing)).rejects.toThrowError(/missing config/u);
  });
});
