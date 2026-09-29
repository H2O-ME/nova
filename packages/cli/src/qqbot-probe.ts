/**
 * The qqbot connection probe: token grant, then gateway lookup.
 *
 * Split from `web-mode.ts` because it is the ONE thing that surface does on
 * behalf of a plugin, and it needs the qqbot package's client while the rest of
 * `web-mode.ts` assembles the web surface. It is also the only piece that talks
 * to real QQ endpoints, so keeping it apart makes "what reaches the network from
 * this process" a file you can read in full.
 */

/**
 * Prove the credentials work end to end and return the gateway URL.
 *
 * "Configured" and "working" are different facts, and only a real round trip can
 * tell them apart: the token grant validates the secret, the gateway lookup
 * validates the app id's standing. The settings page shows the URL as the
 * evidence, so this returns it rather than a bare boolean.
 * @param opts - the candidate credentials (the operator's typed secret, not the stored one).
 * @returns the gateway URL the credentials resolved to.
 * @throws when the grant fails or the gateway answer is unusable.
 */
export async function testQqBotConnection(opts: { appId: string; clientSecret: string }): Promise<string> {
  const { AccessTokenManager } = await import('@nova-agent/qqbot');
  const manager = new AccessTokenManager(opts.appId, opts.clientSecret, globalThis.fetch);
  const token = await manager.get();
  if (token.length === 0) throw new Error('empty access token');
  const res = await globalThis.fetch('https://api.sgroup.qq.com/gateway/bot', {
    headers: { Authorization: `QQBot ${token}` },
  });
  const body = (await res.json().catch(() => undefined)) as { url?: unknown } | undefined;
  if (!res.ok || typeof body?.url !== 'string') {
    throw new Error(`gateway lookup failed (http ${res.status})`);
  }
  return body.url;
}
