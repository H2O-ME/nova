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
import { PluginHost, loadExtraPlugins } from '@nova-agent/plugins';

/**
 * A plugin whose activation is merely WAITING for a service it will find at boot
 * is not a failure, so a fiber still pending at the deadline passes; the timeout
 * is what keeps `add` from hanging on that wait.
 * @param spec - the module spec to load and apply.
 * @param timeoutMs - how long to wait for activation before calling it fine.
 * @returns the failure's message, or undefined when it applies.
 */
export async function applyFailure(spec: string, timeoutMs = 1500): Promise<string | undefined> {
  const loaded = await loadExtraPlugins([spec], process.cwd());
  const host = new PluginHost(process.cwd());
  try {
    for (const plugin of loaded) host.use(plugin);
    return await Promise.race([
      host.activate().then(() => undefined, (err: unknown) => errMessage(err)),
      new Promise<undefined>((resolve) => { setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    await host.dispose().catch(() => undefined);
  }
}
