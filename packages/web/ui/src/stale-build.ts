/**
 * Stale-build detection: an installed PWA (and any long-lived tab) restores
 * its page WITHOUT navigating, so the document — and therefore the bundle it
 * points at — is whatever was current the first time. Reopening the window
 * then shows the old UI forever, which is what "打开的永远是旧界面" is.
 *
 * The server already serves `index.html` as `no-cache` and the bundles are
 * content-hashed, so the only thing missing is asking: on mount and whenever
 * the page becomes visible again, fetch the served document (bypassing any
 * cache), read the bundle it points at, and compare it with the one this page
 * is actually running. A mismatch means the host rebuilt underneath us —
 * reload exactly once per new bundle, or a build change would reload-loop.
 *
 * Everything here is a pure function over strings; the caller owns the fetch
 * and the reload.
 */

/** The bundle a document points at (`/assets/index-XXXXXXXX.js`). */
const ASSET_URL = /\/assets\/index-([A-Za-z0-9_-]+)\.js/u;

/**
 * The bundle name inside a served document, or null when the document does not
 * point at one (the dev server serves modules directly, and a test harness has
 * no document at all).
 * @param html - the served `index.html`.
 * @returns the script's file name, or null.
 */
export function servedAssetName(html: string): string | null {
  const match = ASSET_URL.exec(html);
  return match === null ? null : `index-${match[1]}.js`;
}

/**
 * The bundle THIS page is running, or null when the page was not loaded from
 * one (vite dev, SSR, tests).
 * @param scriptUrl - the module's own URL (`import.meta.url`).
 * @returns the running script's file name, or null.
 */
export function runningAssetName(scriptUrl: string): string | null {
  return scriptUrl.match(ASSET_URL)?.[0].split('/').at(-1) ?? null;
}

/**
 * Whether this page must reload to catch up with the host.
 * @param running - this page's bundle, or null when unknown.
 * @param served - the host's current bundle, or null when unknown.
 * @returns true when both are known and differ.
 */
export function buildIsStale(running: string | null, served: string | null): boolean {
  return running !== null && served !== null && running !== served;
}

/**
 * The marker that makes the reload happen at most once per bundle: without it,
 * a page whose fetch still answers with the older document (an in-flight
 * deploy, a proxy) would reload on every focus.
 * @param storage - the page's sessionStorage (or a stand-in).
 * @param served - the bundle the host is serving.
 * @returns true when this bundle has not already triggered a reload.
 */
export function claimReload(storage: Pick<Storage, 'getItem' | 'setItem'>, served: string): boolean {
  const key = 'nova-reloaded-for';
  if (storage.getItem(key) === served) return false;
  storage.setItem(key, served);
  return true;
}
