/**
 * BYOK provider persistence: the three derived invariants `saveProviders` must
 * keep, and the migration a legacy `provider`-only config gets.
 *
 * These are the properties that make the feature safe rather than the ones that
 * make it work: a saved list whose `activeProvider` dangles, or that erases a
 * secret the browser was never allowed to read, is worse than no BYOK at all.
 * Every case uses a temp home — the real `~/.nova/config.json` is never touched.
 */
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProviders, saveProviders, storedApiKey } from '../src/config-providers.js';

/**
 * A temp home with an optional starting document. The config lives at
 * `<home>/.nova/config.json` — the same layout the product uses, so the test
 * exercises the real path resolution rather than a convenient fiction.
 */
async function homeWith(doc?: unknown): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-byok-'));
  if (doc !== undefined) {
    await mkdir(path.join(home, '.nova'), { recursive: true });
    await writeFile(path.join(home, '.nova', 'config.json'), JSON.stringify(doc), 'utf8');
  }
  return home;
}

/** The document as it now sits on disk. */
async function readDocAt(home: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path.join(home, '.nova', 'config.json'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('readProviders', () => {
  it('presents a legacy provider block as one editable `default` row', async () => {
    const home = await homeWith({
      provider: { baseURL: 'https://legacy.example/v1', apiKey: 'sk-legacy', model: 'm' },
    });
    const snapshot = await readProviders(home);
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]?.id).toBe('default');
    expect(snapshot.providers[0]?.baseURL).toBe('https://legacy.example/v1');
    // The SECRET crosses as a boolean, never as text: the page must be able to say
    // "a key is set" without ever holding it.
    expect(snapshot.providers[0]?.hasApiKey).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('sk-legacy');
  });

  it('is an empty list for a missing file, not an error', async () => {
    const snapshot = await readProviders(await homeWith());
    expect(snapshot.providers).toEqual([]);
    expect(snapshot.activeId).toBeUndefined();
  });
});

describe('saveProviders', () => {
  it('keeps a stored secret when the input omits the key', async () => {
    const home = await homeWith({
      providers: [{ id: 'a', baseURL: 'https://one.example/v1', apiKey: 'sk-keep' }],
      activeProvider: 'a',
    });
    // The page's shape: no `apiKey` field at all (the operator did not retype it).
    await saveProviders([{ id: 'a', name: '官方', baseURL: 'https://one.example/v1' }], 'a', home);
    expect(await storedApiKey('a', home)).toBe('sk-keep');
    const doc = await readDocAt(home);
    const listed = doc['providers'] as Record<string, unknown>[];
    expect(listed[0]?.['name']).toBe('官方');
  });

  it('replaces the key when the input carries one', async () => {
    const home = await homeWith({
      providers: [{ id: 'a', baseURL: 'https://one.example/v1', apiKey: 'sk-old' }],
      activeProvider: 'a',
    });
    await saveProviders([{ id: 'a', baseURL: 'https://one.example/v1', apiKey: 'sk-new' }], 'a', home);
    expect(await storedApiKey('a', home)).toBe('sk-new');
  });

  // The three derived invariants, as one case each — they are the reason this
  // function is more than a JSON write.
  it('re-points a dangling activeProvider at the first remaining row after a delete', async () => {
    const home = await homeWith({
      providers: [
        { id: 'a', baseURL: 'https://one.example/v1', apiKey: 'k1' },
        { id: 'b', baseURL: 'https://two.example/v1', apiKey: 'k2' },
      ],
      activeProvider: 'a',
    });
    // Delete `a` — the active one — and leave `b`.
    await saveProviders([{ id: 'b', baseURL: 'https://two.example/v1' }], 'a', home);
    const doc = await readDocAt(home);
    expect(doc['activeProvider']).toBe('b');
    // The legacy mirror follows the new active row, so every path still reading
    // `config.provider.baseURL` addresses the endpoint that is actually in force.
    expect((doc['provider'] as Record<string, unknown>)['baseURL']).toBe('https://two.example/v1');
  });

  it('mirrors the active row into the legacy provider block', async () => {
    const home = await homeWith({ provider: { model: 'keep-me' } });
    await saveProviders(
      [
        { id: 'a', baseURL: 'https://one.example/v1', apiKey: 'k1', temperature: 0.3 },
        { id: 'b', baseURL: 'https://two.example/v1', apiKey: 'k2' },
      ],
      'b',
      home,
    );
    const doc = await readDocAt(home);
    const legacy = doc['provider'] as Record<string, unknown>;
    expect(legacy['baseURL']).toBe('https://two.example/v1');
    expect(legacy['apiKey']).toBe('k2');
    // `provider.model` is the single "current model" store, so the mirror must
    // PRESERVE it rather than rebuild the block from the provider entry.
    expect(legacy['model']).toBe('keep-me');
    // Selecting `b` must not carry `a`'s temperature along.
    expect(legacy['temperature']).toBeUndefined();
  });

  it('deletes both keys when the list becomes empty, rather than storing []', async () => {
    const home = await homeWith({
      providers: [{ id: 'a', baseURL: 'https://one.example/v1', apiKey: 'k1' }],
      activeProvider: 'a',
    });
    await saveProviders([], undefined, home);
    const doc = await readDocAt(home);
    expect('providers' in doc).toBe(false);
    expect('activeProvider' in doc).toBe(false);
  });

  // The FIRST-RUN case, and the reason `patchConfig` treats a missing file as an
  // empty document: with no config.json at all, this is the only path by which the
  // operator can author their first endpoint. It used to throw `missing config`,
  // so the settings page showed a form whose save could never succeed.
  it('creates the config file when one does not exist yet', async () => {
    const home = await homeWith();
    await saveProviders([{ id: 'first', baseURL: 'https://first.example/v1', apiKey: 'sk-1' }], 'first', home);
    const doc = await readDocAt(home);
    expect(doc['activeProvider']).toBe('first');
    expect((doc['provider'] as Record<string, unknown>)['baseURL']).toBe('https://first.example/v1');
    // The file must be usable by the loader on the next start, not just readable.
    const snapshot = await readProviders(home);
    expect(snapshot.providers[0]?.id).toBe('first');
  });

  it('reads back what it wrote, keeping ids and per-model overrides', async () => {
    const home = await homeWith();
    await saveProviders(
      [
        {
          id: 'a',
          baseURL: 'https://one.example/v1',
          apiKey: 'k1',
          models: [{ id: 'm1', contextWindow: 128_000, attachment: true, inputModalities: ['text', 'image'] }],
        },
      ],
      'a',
      home,
    );
    const snapshot = await readProviders(home);
    expect(snapshot.activeId).toBe('a');
    expect(snapshot.providers[0]?.models[0]).toMatchObject({
      id: 'm1',
      contextWindow: 128_000,
      attachment: true,
      inputModalities: ['text', 'image'],
    });
  });
});
