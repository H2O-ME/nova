/**
 * The config writers a running surface owns: the model seat, ONE plugin row and
 * ONE skill.
 *
 * The load path expands `{env:NAME}`, so these tests pin the property that makes
 * every write safe — they edit the raw document, never the loaded object. A
 * regression here does not fail loudly; it silently replaces a secret reference
 * with the secret.
 *
 * A plugin row is `{ id, enabled?, config? }` and nothing here knows any plugin:
 * `setPluginEntry` upserts by id and merges `config` one key at a time, which is
 * the whole reason a form that owns three fields cannot blank the fourth.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { userConfigPath } from '@nova-agent/core';
import {
  readPluginEntryConfig,
  removePluginEntry,
  saveModelChoice,
  setPluginEntry,
  setSkillEnabled,
} from '../src/config-write.js';

/** A fake home holding `raw` at ~/.nova/config.json. */
async function withConfig(raw: string): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-cfg-'));
  await mkdir(path.join(home, '.nova'), { recursive: true });
  await writeFile(userConfigPath(home), raw, 'utf8');
  return home;
}

/** The parsed document at `home`. */
async function doc(home: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(userConfigPath(home), 'utf8')) as Record<string, unknown>;
}

/** The `plugins.entries` rows at `home` ([] when the key is absent). */
async function rows(home: string): Promise<readonly unknown[]> {
  const plugins = (await doc(home))['plugins'] as Record<string, unknown> | undefined;
  return (plugins?.['entries'] ?? []) as readonly unknown[];
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
    expect((await doc(home))['provider']).toMatchObject({ model: 'new-model', apiKey: 'sk-literal' });
    expect((await doc(home))['maxTurns']).toBe(3);
    expect((await doc(home))['ui']).toEqual({ theme: 'dark' });
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

describe('setPluginEntry', () => {
  it('creates the row, then merges config key by key', async () => {
    const home = await withConfig(JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' } }));
    await setPluginEntry(
      '@nova-agent/qqbot',
      { enabled: true, config: { appId: '1024', clientSecret: 'sekret' } },
      home,
    );
    // A later "appId only" save (a form submits only the fields it owns) must
    // not blank the credential the operator kept.
    await setPluginEntry('@nova-agent/qqbot', { config: { appId: '2048' } }, home);
    expect(await rows(home)).toEqual([
      { id: '@nova-agent/qqbot', enabled: true, config: { appId: '2048', clientSecret: 'sekret' } },
    ]);
  });

  it('deletes one key on null, and leaves an undefined value alone', async () => {
    const home = await withConfig(JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' } }));
    await setPluginEntry('row', { config: { a: 1, b: 2 } }, home);
    await setPluginEntry('row', { config: { b: null, a: undefined } }, home);
    // `null` is how a form clears an optional field; an omitted one means "leave
    // it", because the two cannot be spelled the same way or a form that never
    // mentions a field would erase it.
    expect(await rows(home)).toEqual([{ id: 'row', config: { a: 1 } }]);
    // Nothing left to say: the row goes, rather than persisting as `{}` — a row
    // that only restates the default is exactly what "no entry" already means.
    await setPluginEntry('row', { config: { a: null } }, home);
    expect(await rows(home)).toEqual([]);
  });

  it('replaces rather than merges a non-object config', async () => {
    const home = await withConfig(JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' } }));
    await setPluginEntry('row', { config: { a: 1 } }, home);
    // A plugin may store a scalar or a list; there is nothing to merge it into.
    await setPluginEntry('row', { config: 'plain' }, home);
    expect(await rows(home)).toEqual([{ id: 'row', config: 'plain' }]);
  });

  it('drops a row that would only restate the default', async () => {
    const home = await withConfig(JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' } }));
    await setPluginEntry('todo', {}, home);
    // "No entry" and "an entry with nothing to say" mean the same thing, and the
    // file must not grow a row per click.
    expect((await doc(home))['plugins']).toEqual({});
  });

  it('stores an {env:NAME} value verbatim, and never leaks the expanded secret', async () => {
    process.env['NOVA_CFG_TEST_QQ'] = 'the-real-secret';
    try {
      const home = await withConfig(
        JSON.stringify({
          provider: { baseURL: 'https://x.test/v1', apiKey: '{env:NOVA_CFG_TEST_QQ}', model: 'm' },
        }),
      );
      await setPluginEntry('@nova-agent/qqbot', { config: { clientSecret: '{env:QQ_SECRET}' } }, home);
      const text = await readFile(userConfigPath(home), 'utf8');
      // Verbatim: the field means "read this variable", so the panel must not be
      // able to have its input expanded on the way to disk. And a write to one
      // row must leave its sibling's reference byte-identical — the loaded Config
      // already holds the secret, so a round-trip through it would persist the
      // credential itself into a file the user expects to be shareable.
      expect(text).toContain('{env:QQ_SECRET}');
      expect(text).toContain('{env:NOVA_CFG_TEST_QQ}');
      expect(text).not.toContain('the-real-secret');
    } finally {
      delete process.env['NOVA_CFG_TEST_QQ'];
    }
  });
});

describe('readPluginEntryConfig', () => {
  it('reads the row as WRITTEN, so a reference echoes by name', async () => {
    process.env['NOVA_CFG_TEST_QQ'] = 'the-real-secret';
    try {
      const home = await withConfig(
        JSON.stringify({
          provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' },
          plugins: { entries: [{ id: 'q', config: { appId: '1', clientSecret: '{env:NOVA_CFG_TEST_QQ}' } }] },
        }),
      );
      // The load path has already replaced the reference by the time a plugin is
      // applied, so a page must ask THIS for the raw form — otherwise it cannot
      // tell "read from env" from "written in the file" and a save would
      // overwrite the reference.
      expect(await readPluginEntryConfig('q', home)).toEqual({
        appId: '1',
        clientSecret: '{env:NOVA_CFG_TEST_QQ}',
      });
      await expect(readPluginEntryConfig('absent', home)).resolves.toBeUndefined();
    } finally {
      delete process.env['NOVA_CFG_TEST_QQ'];
    }
  });

  it('reports nothing when the row or its config is absent', async () => {
    const home = await withConfig(JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' }, plugins: { entries: [{ id: 'q' }] } }));
    await expect(readPluginEntryConfig('q', home)).resolves.toBeUndefined();
    const none = await mkdtemp(path.join(tmpdir(), 'nova-cfg-none-'));
    await expect(readPluginEntryConfig('q', none)).resolves.toBeUndefined();
  });
});

describe('removePluginEntry', () => {
  it('removes one row and deletes the list once it is empty', async () => {
    const home = await withConfig(
      JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' }, plugins: { entries: [{ id: 'a' }, { id: 'b' }] } }),
    );
    await removePluginEntry('a', home);
    expect(await rows(home)).toEqual([{ id: 'b' }]);
    await removePluginEntry('b', home);
    // An emptied list DELETES the key: the operator's file must not gain an
    // `"entries": []` they never wrote.
    expect(Object.keys((await doc(home))['plugins'] as object)).not.toContain('entries');
  });
});

describe('setSkillEnabled', () => {
  it('adds a name on disable, removes it on enable, and returns the list in force', async () => {
    const home = await withConfig(JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' } }));
    // The `skills` object is created when the file has none.
    expect(await setSkillEnabled('deep-research', false, home)).toEqual(['deep-research']);
    const disable = ((await doc(home))['skills'] as Record<string, unknown>)['disable'];
    expect(disable).toEqual(['deep-research']);
    expect(await setSkillEnabled('deep-research', true, home)).toEqual([]);
  });

  it('keeps the list sorted and de-duplicated across repeated flips', async () => {
    const home = await withConfig(JSON.stringify({ provider: { baseURL: 'https://x.test/v1', apiKey: 'sk-literal', model: 'm' } }));
    // The switch is a set, not a log: flipping the same name twice must not
    // append it twice, and the stored order is stable so a hand-read config and
    // a rewritten one look the same.
    await setSkillEnabled('zeta', false, home);
    await setSkillEnabled('alpha', false, home);
    await setSkillEnabled('zeta', false, home);
    expect(await setSkillEnabled('mid', false, home)).toEqual(['alpha', 'mid', 'zeta']);
    expect(await setSkillEnabled('alpha', true, home)).toEqual(['mid', 'zeta']);
  });
});

describe('the abort-on-unparseable discipline', () => {
  it('refuses to rewrite a config it cannot parse, and leaves the text alone', async () => {
    const raw = '{ this is not json';
    const home = await withConfig(raw);
    await expect(setPluginEntry('todo', { enabled: false }, home)).rejects.toThrowError(/invalid JSON/u);
    // The whole point of aborting: a document the process cannot understand is
    // one it must not silently overwrite.
    expect(await readFile(userConfigPath(home), 'utf8')).toBe(raw);
  });

  it('refuses a non-object root rather than discarding it', async () => {
    const raw = '[1,2,3]';
    const home = await withConfig(raw);
    await expect(setPluginEntry('todo', { enabled: false }, home)).rejects.toThrowError(/JSON object/u);
    expect(await readFile(userConfigPath(home), 'utf8')).toBe(raw);
  });
});

describe('concurrent patches to one config file', () => {
  it('keeps both changes when two patches race', async () => {
    const home = await withConfig('{}');
    // `tmp + rename` makes one write atomic, but not a read-modify-write: without
    // the per-file queue both patches read `{}` and the second overwrites the
    // first. The panel produces exactly this (a switch and a settings save).
    await Promise.all([
      setPluginEntry('todo', { enabled: false }, home),
      setPluginEntry('ptc', { config: { mode: 'both' } }, home),
    ]);
    const doc = JSON.parse(await readFile(userConfigPath(home), 'utf8')) as {
      plugins?: { entries?: { id: string; enabled?: boolean; config?: unknown }[] };
    };
    const entries = doc.plugins?.entries ?? [];
    expect(entries.find((row) => row.id === 'todo')?.enabled).toBe(false);
    expect(entries.find((row) => row.id === 'ptc')?.config).toEqual({ mode: 'both' });
  });
});
