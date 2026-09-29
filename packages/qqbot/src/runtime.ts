import { AccessTokenManager, QqApi, QqGateway, type CredentialSource, type FetchLike, type SocketFactory } from './protocol.js';
import { InboundHandler, type InboundHandlerOptions } from './inbound.js';
import { qqbotPlugin } from './plugin.js';
import { defaultSocketFactory } from './socket.js';
import type { Peer, QqBotChannelStats } from './types.js';
import type { Plugin } from '@nova-agent/core';

/**
 * 把协议层装配成一个完整通道：WebSocket 事件 →（去重、被动窗口缓存）→
 * brain（agent 侧回调，运行方提供）→ REST 被动回复。返回的 `plugin` 装上
 * 宿主后，agent 还能用 `qqbot_send` 工具在被动窗口内主动发消息。
 *
 * 入站消息「怎么处理」在 `inbound.ts`；本文件只管「怎么装起来、怎么启停」。
 */

export interface QqBotChannelOptions {
  /**
   * Credentials, as a literal or a getter.
   *
   * The getter form is what makes this channel usable from a surface that lets
   * the operator EDIT the credentials while the process runs (`nova --web`'s
   * settings page). The plugin object has to stay stable — it already sits in
   * the roster's candidate list, and rebuilding it would change roster identity —
   * so the credentials are read at request time instead of captured here.
   */
  appId: CredentialSource;
  clientSecret: CredentialSource;
  /** 收到一条群/单聊消息，返回回复文本（运行方的 agent 大脑）。 */
  brain: (text: string, peer: Peer) => Promise<string>;
  fetchFn?: FetchLike;
  socketFactory?: SocketFactory;
  /** 默认 GET https://api.sgroup.qq.com/gateway/bot 取 wss 地址。 */
  gatewayUrl?: () => Promise<string>;
  log?: (line: string) => void;
  /**
   * 入站旁路：见 `InboundHandlerOptions.remote`。
   *
   * 存在的理由是**死锁**：一轮对话是串行的，而一轮可能停在审批上等人回答；如果那句
   * 答复也要排队，它会永远排在自己所等的那一轮后面。所以遥控指令不进队列。
   */
  remote?: InboundHandlerOptions['remote'];
}

export interface QqBotChannel {
  plugin: Plugin;
  api: QqApi;
  start(): Promise<void>;
  stop(): void;
  /** 该通道当前是否已在接收事件（重复 `start()` 是 no-op）。 */
  readonly running: boolean;
  /**
   * 设置页的连接读数：BOT 名称 + 本次运行的计数。异步是因为名称要真的去问一次网关
   * （`GET /users/@me`）；通道没跑起来时**不问**——那会拿一份没人用的凭据去换 token。
   */
  reading(): Promise<QqBotChannelReading>;
  /**
   * 主动往一个对端发一条（`msgId` 缺省时用被动窗口里的最近一条）。
   *
   * 用途是**运行中**的旁路消息：审批问题要在某一轮还没结束时先推出去，而那一步
   * `reply`（被动回复的正确落点）还攥在那一轮手里。
   * @param peerId - `group:<id>` / `c2c:<id>`。
   * @param content - 文本。
   * @returns 发送确认（与工具同形）。
   */
  send(peerId: string, content: string): Promise<string>;
  /** 该对端被动回复窗口里的最近 msg_id（过期即 undefined）。 */
  lastMsgIdOf(peerId: string): string | undefined;
}

/** 设置页要的那一份连接读数（`QqBotChannel.reading`）：计数口径是**本次运行**。 */
export interface QqBotChannelReading extends QqBotChannelStats {
  /** 网关报出的 BOT 用户名；undefined = 通道没跑（没问过），null = 问过但取不到。 */
  botName?: string | null;
}

export function createQqBotChannel(options: QqBotChannelOptions): QqBotChannel {
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const log = options.log ?? (() => undefined);
  const token = new AccessTokenManager(options.appId, options.clientSecret, fetchFn);
  const api = new QqApi(token, fetchFn);

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

  const inbound = new InboundHandler({
    brain: options.brain,
    reply: {
      group: (openid, content, msgId) => api.sendGroupMessage(openid, { content, msgId }).then((sent) => sent.length),
      c2c: (openid, content, msgId) => api.sendC2CMessage(openid, { content, msgId }).then((sent) => sent.length),
    },
    log,
    ...(options.remote !== undefined ? { remote: options.remote } : {}),
  });

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
    socketFactory: options.socketFactory ?? defaultSocketFactory,
    onDispatch: inbound.onDispatch,
    onLog: log,
  });

  // 幂等：设置页每保存一次凭据就会要求启动一次，而网关每次 `connect()` 都会新开一条
  // WebSocket。没有这道闸门，重复保存会叠出多条并行连接，同一条消息被投递多次。
  let started = false;

  return {
    plugin: qqbotPlugin({ send, lastMsgIdOf: (peerId) => inbound.msgIdOf(peerId) }),
    api,
    send,
    lastMsgIdOf: (peerId) => inbound.msgIdOf(peerId),
    reading: async () => ({ ...inbound.stats(), ...(started ? { botName: await api.botName() } : {}) }),
    start: async () => {
      if (started) return;
      started = true;
      try {
        await gateway.connect();
      } catch (err) {
        // 连不上就让下一次（比如改完凭据再保存）还能重试，而不是永久卡在「已启动」。
        started = false;
        throw err;
      }
    },
    stop: () => {
      started = false;
      gateway.close();
    },
    get running() {
      return started;
    },
  };
}
