import { errMessage } from '@nova-agent/core';
import { AccessTokenManager, QqApi, QqGateway, type FetchLike, type SocketFactory } from './protocol.js';
import { parseInbound, type Peer } from './types.js';
import { qqbotPlugin } from './plugin.js';
import type { Plugin } from '@nova-agent/plugins';

/**
 * 把协议层装配成一个完整通道：WebSocket 事件 →（去重、被动窗口缓存）→
 * brain（agent 侧回调，运行方提供）→ REST 被动回复。返回的 `plugin` 装上
 * 宿主后，agent 还能用 `qqbot_send` 工具在被动窗口内主动发消息。
 */

export interface QqBotChannelOptions {
  appId: string;
  clientSecret: string;
  /** 收到一条群/单聊消息，返回回复文本（运行方的 agent 大脑）。 */
  brain: (text: string, peer: Peer) => Promise<string>;
  fetchFn?: FetchLike;
  socketFactory?: SocketFactory;
  /** 默认 GET https://api.sgroup.qq.com/gateway/bot 取 wss 地址。 */
  gatewayUrl?: () => Promise<string>;
  log?: (line: string) => void;
}

/** 被动回复窗口（略短于官方上限，留出网络余量）：群 5 分钟、单聊 60 分钟。 */
const GROUP_WINDOW_MS = 4.5 * 60_000;
const C2C_WINDOW_MS = 55 * 60_000;
/** 事件去重缓存上限（同一 msg_id 可能重复推送）。 */
const DEDUPE_CAP = 512;

export interface QqBotChannel {
  plugin: Plugin;
  api: QqApi;
  start(): Promise<void>;
  stop(): void;
}

export function createQqBotChannel(options: QqBotChannelOptions): QqBotChannel {
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const log = options.log ?? (() => undefined);
  const token = new AccessTokenManager(options.appId, options.clientSecret, fetchFn);
  const api = new QqApi(token, fetchFn);
  /** 每个对端最近一条入站 msg_id 与落库时间（被动窗口）。 */
  const passive = new Map<string, { msgId: string; at: number }>();
  const dedupe = new Set<string>();
  /** 全局串行：低流量场景下避免并发 brain 调用竞争共享 client 会话亲和。 */
  let queue: Promise<void> = Promise.resolve();

  const resolveGatewayUrl =
    options.gatewayUrl ??
    (async (): Promise<string> => {
      const res = await fetchFn('https://api.sgroup.qq.com/gateway/bot', {
        headers: { Authorization: `QQBot ${await token.get()}` },
      });
      const body = (await res.json()) as { url?: unknown };
      if (!res.ok || typeof body.url !== 'string') throw new Error(`qqbot: gateway lookup failed (${res.status})`);
      return body.url;
    });

  const lastMsgIdOf = (peerId: string): string | undefined => {
    const hit = passive.get(peerId);
    if (hit === undefined) return undefined;
    const window = peerId.startsWith('group:') ? GROUP_WINDOW_MS : C2C_WINDOW_MS;
    if (Date.now() - hit.at > window) return undefined;
    return hit.msgId;
  };

  const send = async (peerId: string, content: string, msgId?: string): Promise<string> => {
    const [kind, openid] = [peerId.slice(0, peerId.indexOf(':')), peerId.slice(peerId.indexOf(':') + 1)];
    const sent =
      kind === 'group'
        ? await api.sendGroupMessage(openid, { content, ...(msgId !== undefined ? { msgId } : {}) })
        : await api.sendC2CMessage(openid, { content, ...(msgId !== undefined ? { msgId } : {}) });
    return `${sent.length} message(s), last id ${sent.at(-1)?.id ?? 'n/a'}`;
  };

  const gateway = new QqGateway({
    appId: options.appId,
    token,
    resolveGatewayUrl,
    socketFactory: options.socketFactory ?? (async (url) => {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('websocket open failed')), { once: true });
      });
      return {
        send: (data) => ws.send(data),
        close: () => ws.close(),
        onMessage: (cb) => ws.addEventListener('message', (ev) => cb(String((ev as MessageEvent).data))),
        onClose: (cb) => ws.addEventListener('close', () => cb(false)),
      };
    }),
    onDispatch: (event) => {
      const inbound = parseInbound(event.t, event.d);
      if (inbound === undefined) return;
      const { peer, message } = inbound;
      // 平台会重复推送同一 msg_id —— 去重后再入队。
      if (dedupe.has(message.id)) return;
      dedupe.add(message.id);
      if (dedupe.size > DEDUPE_CAP) {
        const oldest = dedupe.values().next().value;
        if (oldest !== undefined) dedupe.delete(oldest);
      }
      passive.set(peer.peerId, { msgId: message.id, at: Date.now() });
      const text = message.content.trim();
      if (text.length === 0) return;
      queue = queue
        .then(async () => {
          let reply: string;
          try {
            reply = await options.brain(text, peer);
          } catch (err) {
            log(`brain failed for ${peer.peerId}: ${errMessage(err)}`);
            reply = '（处理消息时出错，请稍后重试）';
          }
          if (reply.trim().length === 0) return;
          const sent =
            peer.kind === 'group'
              ? await api.sendGroupMessage(peer.openid, { content: reply, msgId: message.id })
              : await api.sendC2CMessage(peer.openid, { content: reply, msgId: message.id });
          log(`replied ${peer.peerId}: ${sent.length} message(s)`);
        })
        .catch((err: unknown) => {
          log(`reply failed for ${peer.peerId}: ${errMessage(err)}`);
        });
    },
    onLog: log,
  });

  return {
    plugin: qqbotPlugin({ send, lastMsgIdOf }),
    api,
    start: () => gateway.connect(),
    stop: () => gateway.close(),
  };
}
