/**
 * The settings page's qqbot frames: the connection snapshot, the save, and the
 * probe.
 *
 * Split from `manage-frames.ts` the way `provider-frames.ts` already is, and for
 * the same kind of reason: the family shares the settings discipline (**persist
 * first, then reload, then answer with state**) but owns a step the plugin and
 * Skill rows do not — a save must make the CHANNEL RUN, not merely store
 * credentials. That step is why this is a file rather than three cases: storing
 * is a write to the config file, connecting is an act in this process, and the
 * two take different collaborators (`persistQqBot` vs `qqBotRuntime`).
 *
 * The secret never crosses to the browser in any answer here: the page learns
 * whether one is stored and whether it is a `{env:NAME}` reference, which is what
 * it draws 「已配置」 from.
 */
import { errMessage, hasControlChars } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/** The qqbot snapshot as the page sees it — never the secret itself. */
export interface QqBotSnapshot {
  appId?: string;
  hasClientSecret?: boolean;
  /** Variable name when the stored secret is exactly `{env:NAME}`. */
  clientSecretRef?: string;
  /**
   * Why the bot cannot connect right now, when the shell loaded its config with
   * an unresolved reference. A saved credential CLEARS it: the operator has just
   * replaced the stored value, so the old complaint is about text that no longer
   * exists.
   */
  error?: string;
  /**
   * Whether the gateway is live in this process RIGHT NOW.
   *
   * This is NOT `appId !== undefined`: stored credentials and a running channel
   * are different facts, and the page draws three states from them (未配置 /
   * 已配置但未启动 / 运行中). Absent means "this surface cannot tell", which the
   * page renders exactly as it did before the field existed.
   */
  running?: boolean;
  live?: QqBotLiveReading;
}

/** The connection reading the host attests to; the page turns it into sentences (`qqbot-view.ts`). */
export interface QqBotLiveReading {
  /** Started, but not connected yet (the dial is in flight). */
  connecting: boolean;
  /** Whether the plugin is enabled in the roster; absent = this host cannot tell. */
  pluginEnabled?: boolean;
  /** Why it is not connected, in the host's own words; absent = nothing failed. */
  failure?: string;
  /** The gateway's own username for this bot; null = asked and could not get it. */
  botName?: string | null;
  /** This run's tallies (basis: the PROCESS — a restart starts over). */
  stats?: { received: number; replied: number; lastReceivedAt?: number };
}

/**
 * The shell's view of the LIVE QQ channel, when it has one.
 *
 * Two operations rather than two unrelated seams because they are one thing: the
 * channel this process is running (or could run). `running` answers the page's
 * opening question; `afterSave` is what makes a save DO something — it re-reads
 * the file that was just written, re-derives the diagnostic, opts the plugin in
 * and dials the gateway, all without a restart, which is precisely what the
 * operator asked for when they typed credentials into the form.
 */
export interface QqBotRuntime {
  /** Is the gateway up right now? */
  running(): boolean;
  /**
   * Re-evaluate the channel from disk after a save.
   * @returns the sentence to show, or undefined when it is running (or already was).
   */
  afterSave(): Promise<string | undefined>;
  /** The connection reading (`QqBotLiveReading`); may ask the gateway for the bot's username. */
  connection?(): Promise<QqBotLiveReading>;
  /**
   * Hang up the gateway. Turning the plugin's row off must actually stop the
   * channel: the gateway lives in the shell's bridge, NOT in the plugin's
   * effects, so the roster flip alone leaves the socket open.
   */
  stop?(): void;
}

/** The qqbot frames' collaborators, supplied by the controller. */
export interface QqBotHost {
  /** The page's config writer; absent with no durable home, and a save then refuses. */
  persistQqBot: ((opts: { appId?: string; clientSecret?: string }) => void | Promise<void>) | undefined;
  qqBotSnapshot(): QqBotSnapshot;
  setQqBotSnapshot(snapshot: QqBotSnapshot): void;
  /** The live channel, when this surface runs one. */
  qqBotRuntime?: QqBotRuntime | undefined;
  testQqBot: ((opts: { appId: string; clientSecret: string }) => Promise<string>) | undefined;
  /**
   * Re-derive the qqbot diagnostic from what is now on disk, after a save.
   *
   * The rule for "is this stored value usable" lives in the shell (it owns the
   * config file and the `{env:NAME}` rule), so the panel asks instead of
   * re-implementing it: a save that stores ANOTHER unresolved reference must keep
   * reporting the problem, and one that stores a real secret must stop.
   */
  recheckQqBot?: (() => Promise<string | undefined>) | undefined;
}

/**
 * The stored snapshot, plus the live reading when the shell runs a channel.
 *
 * Merged at SEND time rather than stored, because "is it running" is not a
 * property of the file: a value captured into the snapshot would be a claim
 * about the past. `undefined` (no channel) leaves the fields off — see
 * `QqBotLiveReading`.
 */
async function snapshotWithRuntime(host: QqBotHost): Promise<QqBotSnapshot> {
  const stored = host.qqBotSnapshot();
  const runtime = host.qqBotRuntime;
  if (runtime === undefined) return stored;
  const base = { ...stored, running: runtime.running() };
  const live = runtime.connection === undefined ? undefined : await runtime.connection();
  return live === undefined ? base : { ...base, live };
}

/**
 * Handle one qqbot frame.
 * @param client - the connection to answer.
 * @param frame - the `qqbot` / `save_qqbot` / `test_qqbot` frame.
 * @param host - the collaborators above.
 */
export async function handleQqBotFrame(
  client: WsConnection,
  frame: Extract<ClientFrame, { type: 'qqbot' } | { type: 'save_qqbot' } | { type: 'test_qqbot' }>,
  host: QqBotHost,
): Promise<void> {
  try {
    switch (frame.type) {
      case 'qqbot':
        // The snapshot NEVER carries the secret: the panel learns whether one is
        // stored and whether it is a reference — enough to draw 「已配置/未配置」
        // without ever holding a credential.
        client.send(serialize({ type: 'qqbot', ...await snapshotWithRuntime(host) }));
        break;
      case 'save_qqbot': {
        if (host.persistQqBot === undefined) {
          client.send(serialize({ type: 'error', message: '当前服务没有可写的配置文件' }));
          break;
        }
        const appId = frame.appId?.trim() ?? '';
        const secret = frame.clientSecret ?? '';
        if (appId.length === 0) {
          client.send(serialize({ type: 'error', message: 'appId 不能为空' }));
          break;
        }
        if (hasControlChars(appId) || hasControlChars(secret)) {
          client.send(serialize({ type: 'error', message: '凭据中不能包含控制字符' }));
          break;
        }
        // An empty secret field means "keep what is stored" — the browser never
        // holds the stored secret, so it cannot send it back. Only a non-empty
        // field overwrites.
        await host.persistQqBot(secret.length > 0 ? { appId, clientSecret: secret } : { appId });
        // Re-read the stored shape for the snapshot: a saved `{env:NAME}` reports
        // its variable, a literal reports "set" without echoing it.
        const ref = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(secret);
        // The diagnostic is re-derived rather than cleared: saving a DIFFERENT
        // unresolved reference leaves the bot just as unusable, and clearing the
        // complaint would claim a fix that did not happen.
        const error = host.recheckQqBot === undefined ? undefined : await host.recheckQqBot();
        // THEN make the save DO something. Storing the credentials is not
        // connecting them: the channel was built at boot, when this file had
        // nothing in it, so a save that stops at the writer leaves a
        // configured-looking bot that answers nothing — the reported defect. The
        // shell re-reads what it just wrote, opts the plugin in and dials.
        const after = host.qqBotRuntime === undefined ? undefined : await host.qqBotRuntime.afterSave();
        // Whose verdict wins: when the shell ran the channel, ITS answer is the
        // authoritative one — `undefined` there means "it started", which must
        // CLEAR a boot-time complaint the save just fixed. Without a channel, fall
        // back to the diagnostic re-read.
        const verdict = host.qqBotRuntime === undefined ? error : after;
        host.setQqBotSnapshot({
          appId,
          hasClientSecret: secret.length > 0 ? true : host.qqBotSnapshot().hasClientSecret,
          ...(ref?.[1] !== undefined ? { clientSecretRef: ref[1] } : {}),
          ...(verdict !== undefined ? { error: verdict } : {}),
        });
        client.send(serialize({ type: 'qqbot', ...await snapshotWithRuntime(host) }));
        break;
      }
      case 'test_qqbot': {
        if (host.testQqBot === undefined) {
          client.send(serialize({ type: 'error', message: '当前服务不支持连接测试' }));
          break;
        }
        const appId = frame.appId?.trim() ?? '';
        const secret = frame.clientSecret ?? '';
        if (appId.length === 0 || secret.length === 0) {
          client.send(serialize({ type: 'error', message: '测试连接需要填写 appId 与密钥' }));
          break;
        }
        try {
          const gateway = await host.testQqBot({ appId, clientSecret: secret });
          client.send(serialize({ type: 'qqbot_test', ok: true, gateway }));
        } catch (err) {
          client.send(serialize({ type: 'qqbot_test', ok: false, message: errMessage(err) }));
        }
        break;
      }
    }
  } catch (err) {
    client.send(serialize({ type: 'error', message: errMessage(err) }));
  }
}
