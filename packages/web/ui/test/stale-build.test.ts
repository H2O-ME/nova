/**
 * Stale-build detection (`stale-build.ts`).
 *
 * The contract: a page only reloads when it can PROVE it is behind — both
 * bundles known and different — and never twice for the same bundle, because a
 * fetch that still answers with the older document would otherwise reload on
 * every focus.
 */
import { describe, expect, it } from 'vitest';
import { buildIsStale, claimReload, runningAssetName, servedAssetName } from '../src/stale-build.js';

describe('stale build', () => {
  it('reads the bundle a served document points at', () => {
    const html = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-DbIGPGCX.js"></script></head></html>';
    expect(servedAssetName(html)).toBe('index-DbIGPGCX.js');
    expect(servedAssetName('<html><body>dev</body></html>')).toBeNull();
  });

  it('reads the bundle this page is running', () => {
    expect(runningAssetName('http://127.0.0.1:5199/assets/index-AjtjAjqv.js')).toBe('index-AjtjAjqv.js');
    // The dev server serves modules directly: nothing to compare with.
    expect(runningAssetName('http://127.0.0.1:5199/src/main.tsx')).toBeNull();
  });

  it('a page is stale only when both bundles are known and differ', () => {
    expect(buildIsStale('index-A.js', 'index-B.js')).toBe(true);
    expect(buildIsStale('index-A.js', 'index-A.js')).toBe(false);
    expect(buildIsStale(null, 'index-B.js')).toBe(false);
    expect(buildIsStale('index-A.js', null)).toBe(false);
  });

  it('claims one reload per bundle, and no more', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
    expect(claimReload(storage, 'index-B.js')).toBe(true);
    expect(claimReload(storage, 'index-B.js')).toBe(false);
    // The next build is a new claim: a second rebuild must still be able to
    // refresh the page.
    expect(claimReload(storage, 'index-C.js')).toBe(true);
  });
});
