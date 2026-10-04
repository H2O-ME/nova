/**
 * The `nova plugin add` probe: prove the module can be APPLIED, not merely that
 * it exports the right SHAPE.
 *
 * Every exported function passes the shape check (a bare function IS a plugin by
 * protocol), so a plain helper — `is-odd` and friends — would be remembered as a
 * plugin and then explode at the NEXT BOOT, far from the command that installed
 * it. The cheapest honest proof is the boot itself: apply it once to a throwaway
 * host (no tools registered anywhere real) and let the error surface here.
 *
 * Split from `plugin-command.ts` because that file decides WHAT to install and in
 * what order, while this one only answers "does the thing actually run".
 */
import { errMessage } from '@nova-agent/core';
import { PluginHost, loadPluginModule } from '@nova-agent/plugins';

/**
 * A plugin whose activation is merely WAITING for a service it will find at boot
 * is not a failure, so a fiber still pending at the deadline passes; the timeout
 * is what keeps `add` from hanging on that wait.
 * @param spec - the module spec to load and apply.
 * @param appModulesUrl - this cli's own module URL, the anchor bare names resolve
 *   against — the very anchor boot uses, so the verdict here matches the next boot.
 * @param timeoutMs - how long to wait for activation before calling it fine.
 * @returns the failure's message, or undefined when it applies.
 */
export async function applyFailure(spec: string, appModulesUrl?: string, timeoutMs = 1500): Promise<string | undefined> {
  // The boot path's own loader, so the check is the very one the next boot runs:
  // one rule for "is this a plugin", rather than a second shape test here.
  const plugin = await loadPluginModule(spec, appModulesUrl);
  const host = new PluginHost(process.cwd());
  try {
    // `sync` does NOT reject when a plugin's `apply` throws — by design, the
    // loader records the reason on the row and logs it, because a broken plugin
    // must never take the host down (core's `loader.activate`). So the verdict
    // has to be READ OFF THE ROW once activation settles: awaiting `sync` alone
    // would report success for every package that fails on activation, which is
    // the exact case this probe exists to catch.
    const settled = host.sync([{ id: spec, plugin }]).then(
      () => host.errorOf(spec),
      (err: unknown) => errMessage(err),
    );
    return await Promise.race([
      settled,
      new Promise<undefined>((resolve) => { setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    await host.dispose().catch(() => undefined);
  }
}
