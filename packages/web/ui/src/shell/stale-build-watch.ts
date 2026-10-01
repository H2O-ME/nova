/**
 * The stale-build watch: the side-effect half of `stale-build.ts`. Mounted
 * once from the entry point; it asks the host for the document it is serving
 * whenever this page becomes visible, and reloads when that document points at
 * a different bundle than the one running (`stale-build.ts` explains why a PWA
 * needs this). Failures are silent: a fetch that cannot complete leaves the
 * page exactly as it is — the check is a courtesy, never a gate.
 */
import { buildIsStale, claimReload, runningAssetName, servedAssetName } from '../stale-build.js';

/**
 * Ask the host what it is serving now, and reload once when this page is
 * behind. Re-armed on every visibility change (a restored PWA window fires
 * one) and once at start.
 * @param scriptUrl - this module's own URL, i.e. the running bundle.
 */
export function watchForStaleBuild(scriptUrl: string): void {
  const running = runningAssetName(scriptUrl);
  // A page that did not load from a built bundle (dev server, tests) has
  // nothing to compare against.
  if (running === null) return;
  const check = (): void => {
    // `no-store`: the whole point is to bypass whatever the browser cached.
    void fetch('/', { cache: 'no-store', headers: { accept: 'text/html' } })
      .then((response) => (response.ok ? response.text() : ''))
      .then((html) => {
        const served = servedAssetName(html);
        if (!buildIsStale(running, served) || served === null) return;
        if (!claimReload(window.sessionStorage, served)) return;
        window.location.reload();
      })
      .catch(() => undefined);
  };
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
