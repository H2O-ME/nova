/**
 * Browser-side plugin loader — pure-logic tests (no DOM).
 *
 * The UI test lane is `environment: 'node'` with no jsdom (the rest of the
 * layer tests via SSR-to-string + pure reducers). The loader's DOM touch is
 * one tiny function (`injectScript`); everything else is pure and tested
 * here. The cases that exercise the script-tag plumbing use the test-only
 * `resolvePendingLoad` / `rejectPendingLoad` helpers, which stand in for
 * what the script's `onload`/`onerror` would do in a real browser.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  buildBundleUrl,
  entriesToLoad,
  getLoadedPlugin,
  loadBootGraph,
  loadClientPlugin,
  readContributions,
  registerClientPlugin,
  rejectPendingLoad,
  resetClientLoader,
  resolvePendingLoad,
  setScriptInjector,
  writeContributions,
  PLUGIN_GLOBAL_KEY,
  type BootGraphEntry,
  type ClientPluginContributions,
} from '../src/plugins/client-loader.js';

beforeEach(() => {
  resetClientLoader();
  // No-op injector: leaves the pending entry in place so the test-only
  // resolvers (resolvePendingLoad / rejectPendingLoad) drive settlement.
  setScriptInjector(() => undefined);
});

afterEach(() => {
  setScriptInjector(undefined);
  resetClientLoader();
});

describe('client plugin loader — pure logic', () => {
  it('buildBundleUrl: defaults to client.js and omits rev when empty', () => {
    expect(buildBundleUrl('plain', {})).toBe('/plugins/plain/client.js');
    expect(buildBundleUrl('plain', { path: 'client.js' })).toBe('/plugins/plain/client.js');
    expect(buildBundleUrl('plain', { rev: '' })).toBe('/plugins/plain/client.js');
  });

  it('buildBundleUrl: appends rev as query when present', () => {
    expect(buildBundleUrl('a', { rev: 'r1' })).toBe('/plugins/a/client.js?rev=r1');
    expect(buildBundleUrl('a', { path: 'sub/x.js', rev: 'r1' })).toBe('/plugins/a/sub/x.js?rev=r1');
  });

  it('buildBundleUrl: encodes the plugin name (special chars)', () => {
    expect(buildBundleUrl('@org/genui', { rev: 'abc' })).toBe(
      '/plugins/%40org%2Fgenui/client.js?rev=abc',
    );
  });

  it('buildBundleUrl: strips leading slashes from the bundle path', () => {
    expect(buildBundleUrl('a', { path: '/leading/slash.js' })).toBe('/plugins/a/leading/slash.js');
  });

  it('entriesToLoad: keeps enabled plugins with a bundle, skips the rest', () => {
    const entries: BootGraphEntry[] = [
      { name: 'good', enabled: true, clientBundle: { rev: 'r1' } },
      { name: 'disabled', enabled: false, clientBundle: {} },
      { name: 'server-only', enabled: true },
      { name: 'no-flag', clientBundle: {} },
    ];
    const kept = entriesToLoad(entries);
    expect(kept.map((e) => e.name)).toEqual(['good', 'no-flag']);
  });

  it('entriesToLoad: an enabled row that is not active ships no bundle', () => {
    // `apply()` throwing reads `{ enabled: true, state: 'failed' }` — the switch
    // is on (the operator did ask for it) and the plugin is broken. Its route
    // and its RPC namespace went with the failed fiber, so a bundle fetched
    // there 404s and that failure is FINAL for the page. `pending` / `loading`
    // are the same call from the other side: `apply` has not registered the
    // route yet, so trying early is worse than skipping. A row with no `state`
    // at all is a host that does not report phases — load as before.
    const entries: BootGraphEntry[] = [
      { name: 'broken', enabled: true, state: 'failed', clientBundle: {} },
      { name: 'starting', enabled: true, state: 'loading', clientBundle: {} },
      { name: 'live', enabled: true, state: 'active', clientBundle: {} },
      { name: 'old-host', enabled: true, clientBundle: {} },
    ];
    expect(entriesToLoad(entries).map((e) => e.name)).toEqual(['live', 'old-host']);
  });

  it('writeContributions / readContributions: round-trip via the global', () => {
    const c: ClientPluginContributions = { fence: 'renderer-x' };
    writeContributions('p', c);
    expect(readContributions('p')).toBe(c);
    // The global is the documented register target.
    const global = globalThis as unknown as Record<string, unknown>;
    const store = global[PLUGIN_GLOBAL_KEY] as Record<string, ClientPluginContributions> | undefined;
    expect(store?.['p']).toBe(c);
  });

  it('writeContributions ignores an empty name (fail-closed)', () => {
    writeContributions('', { x: 1 });
    expect(readContributions('')).toBeUndefined();
  });
});

describe('client plugin loader — memoization via test-only resolvers', () => {
  it('a resolved load publishes contributions and clears the pending slot', async () => {
    const promise = loadClientPlugin('a', {});
    resolvePendingLoad('a', { k: 1 });
    await expect(promise).resolves.toEqual({ k: 1 });
    expect(getLoadedPlugin('a')).toEqual({ k: 1 });
  });

  it('a rejected load publishes the error and is final for the page', async () => {
    const p1 = loadClientPlugin('broken', {});
    rejectPendingLoad('broken', new Error('boom'));
    await expect(p1).rejects.toThrow('boom');
    const p2 = loadClientPlugin('broken', {});
    await expect(p2).rejects.toThrow('boom');
    expect(getLoadedPlugin('broken')).toBeInstanceOf(Error);
  });

  it('repeat calls before settlement share one pending entry (no double load)', async () => {
    const p1 = loadClientPlugin('shared', {});
    const p2 = loadClientPlugin('shared', {});
    resolvePendingLoad('shared', { ok: true });
    await expect(p1).resolves.toEqual({ ok: true });
    await expect(p2).resolves.toEqual({ ok: true });
  });

  it('a settled plugin serves subsequent calls from the cache', async () => {
    resolvePendingLoad('cached', { v: 1 });
    await expect(loadClientPlugin('cached', {})).resolves.toEqual({ v: 1 });
  });

  it('rejects an empty plugin name fail-closed', async () => {
    await expect(loadClientPlugin('', {})).rejects.toThrow(/empty/);
  });

  it('registerClientPlugin short-circuits host-bundled plugins (no pending)', async () => {
    registerClientPlugin('host', { factory: () => null });
    await expect(loadClientPlugin('host', {})).resolves.toMatchObject({ factory: expect.any(Function) });
    expect(getLoadedPlugin('host')).toMatchObject({ factory: expect.any(Function) });
  });
});

describe('client plugin loader — loadBootGraph', () => {
  it('walks enabled plugins and reports per-plugin success or failure in parallel', async () => {
    const entries: BootGraphEntry[] = [
      { name: 'good', enabled: true, clientBundle: { rev: 'r1' } },
      { name: 'bad', enabled: true, clientBundle: {} },
      { name: 'skipped', enabled: false, clientBundle: {} },
      { name: 'server-only', enabled: true },
    ];
    const all = loadBootGraph(entries);
    // Both loadable plugins are pending — resolve them in any order.
    resolvePendingLoad('good', { v: 1 });
    rejectPendingLoad('bad', new Error('404'));
    const reports = await all;
    const byName = Object.fromEntries(reports.map((r) => [r.name, r]));
    expect(byName['good']).toMatchObject({ name: 'good', contributions: { v: 1 } });
    expect(byName['bad']).toMatchObject({ name: 'bad', error: expect.any(Error) });
    expect(byName['skipped']).toBeUndefined();
    expect(byName['server-only']).toBeUndefined();
  });

  it('returns an empty array when no plugin ships a client bundle', async () => {
    const entries: BootGraphEntry[] = [
      { name: 'a', enabled: true },
      { name: 'b', enabled: false, clientBundle: {} },
    ];
    expect(await loadBootGraph(entries)).toEqual([]);
  });
});
