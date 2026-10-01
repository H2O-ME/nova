import { errMessage } from '@nova-agent/core';
// The credential/token layer lives in `token.ts` (see that file for why it is split).
// Imported for local use by the gateway below, and re-exported so `protocol.ts` keeps
// answering the same questions it always did: every existing importer (`runtime.ts`,
// `surface/probe.ts`, the protocol tests) reads the token manager and the fetch types
// from this module, and the package's public surface is a flat `export *` over these
// files — dropping the re-export would silently shrink that surface.
import { AccessTokenManager, TOKEN_ENDPOINT, type CredentialSource, type FetchLike, type HttpClientResponse } from './token.js';
export { AccessTokenManager, TOKEN_ENDPOINT, type CredentialSource, type FetchLike, type HttpClientResponse };
// ------------------------------------------------------------------ gateway

/** op codes（官方 event-emit 协议）。 */
export const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

/** 群聊 + 单聊（C2C）事件 intent（1<<25 = 33554432）。 */
export const INTENT_GROUP_AND_C2C = 1 << 25;

export interface GatewayDispatch {
  /** 事件类型（GROUP_AT_MESSAGE_CREATE / C2C_MESSAGE_CREATE / READY …）。 */
  t: string;
  d: unknown;
  /** 事件外层 id（可作发消息 event_id）。 */
  id?: string;
  /** 序列号（心跳与 resume 用）。 */
  s?: number;
}

export interface GatewaySocket {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: (hadError: boolean) => void): void;
}

export type SocketFactory = (url: string) => Promise<GatewaySocket>;

export interface QqGatewayOptions {
  /** 与 `AccessTokenManager` 同源；网关本身只用 token，保留供调用方标注。 */
  appId: CredentialSource;
  token: AccessTokenManager;
  /** GET /gateway/bot 的替代（测试注入）。 */
  resolveGatewayUrl: () => Promise<string>;
  socketFactory: SocketFactory;
  onDispatch: (event: GatewayDispatch) => void;
  onReady?: (info: { sessionId: string; resumed: boolean }) => void;
  onLog?: (line: string) => void;
  /** 重连退避上限（默认 30s）。 */
  maxBackoffMs?: number;
}

/**
 * WebSocket 网关状态机。生命周期：connect() 后自动 Hello→Identify→心跳→
 * 分发；断线（close/心跳超时/op7/op9）自动重连——先尝试 Resume（op6 携带
 * session_id + 最后序列号），失效（op9）后退回重新 Identify。所有定时器
 * 走注入的 setTimeout/setTimeout 清除对，测试可用假时钟驱动。
 */
export class QqGateway {
  private socket: GatewaySocket | undefined;
  private sessionId: string | undefined;
  private lastSeq: number | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private ackDeadline: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs = 1_000;
  private disposed = false;

  constructor(private readonly opts: QqGatewayOptions) {}

  async connect(): Promise<void> {
    if (this.disposed) return;
    const url = await this.opts.resolveGatewayUrl();
    const socket = await this.opts.socketFactory(url);
    this.socket = socket;
    socket.onMessage((data) => this.onFrame(data));
    socket.onClose(() => {
      if (this.disposed) return;
      this.stopTimers();
      void this.scheduleReconnect('connection closed');
    });
  }

  close(): void {
    this.disposed = true;
    this.stopTimers();
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
  }

  private log(line: string): void {
    this.opts.onLog?.(line);
  }

  private onFrame(raw: string): void {
    let frame: { op?: unknown; d?: unknown; t?: unknown; s?: unknown; id?: unknown };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      this.log(`dropping non-JSON frame (${raw.length} bytes)`);
      return;
    }
    const op = typeof frame.op === 'number' ? frame.op : -1;
    if (op === OP.DISPATCH) {
      if (typeof frame.s === 'number') this.lastSeq = frame.s;
      const t = typeof frame.t === 'string' ? frame.t : '';
      if (t === 'READY') {
        const d = frame.d as { session_id?: unknown } | undefined;
        if (typeof d?.session_id === 'string') this.sessionId = d.session_id;
        this.backoffMs = 1_000;
        this.opts.onReady?.({ sessionId: this.sessionId ?? '', resumed: false });
      } else if (t === 'RESUMED') {
        this.backoffMs = 1_000;
        this.opts.onReady?.({ sessionId: this.sessionId ?? '', resumed: true });
      }
      this.opts.onDispatch({
        t,
        d: frame.d,
        ...(typeof frame.id === 'string' ? { id: frame.id } : {}),
        ...(typeof frame.s === 'number' ? { s: frame.s } : {}),
      });
      return;
    }
    if (op === OP.HELLO) {
      const interval = (frame.d as { heartbeat_interval?: unknown } | undefined)?.heartbeat_interval;
      const ms = typeof interval === 'number' && interval > 0 ? interval : 45_000;
      if (this.sessionId !== undefined && this.lastSeq !== undefined) {
        void this.resumeOrIdentify(true, ms);
      } else {
        void this.resumeOrIdentify(false, ms);
      }
      return;
    }
    if (op === OP.HEARTBEAT_ACK) {
      if (this.ackDeadline !== undefined) clearTimeout(this.ackDeadline);
      this.ackDeadline = undefined;
      return;
    }
    if (op === OP.RECONNECT) {
      // 服务端要求重连：直接断开，onClose 里的重连逻辑接管。
      this.socket?.close();
      return;
    }
    if (op === OP.INVALID_SESSION) {
      // 会话失效：丢弃 resume 凭据，重连后重新 Identify。
      this.sessionId = undefined;
      this.lastSeq = undefined;
      this.socket?.close();
      return;
    }
  }

  private async resumeOrIdentify(resume: boolean, heartbeatMs: number): Promise<void> {
    const token = await this.opts.token.get();
    const payload = resume
      ? { op: OP.RESUME, d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.lastSeq } }
      : {
          op: OP.IDENTIFY,
          d: {
            token: `QQBot ${token}`,
            intents: INTENT_GROUP_AND_C2C,
            shard: [0, 1],
            properties: { $os: process.platform, $browser: 'nova', $device: 'nova' },
          },
        };
    this.socket?.send(JSON.stringify(payload));
    this.startHeartbeat(heartbeatMs);
    this.log(resume ? 'gateway resumed' : 'gateway identified');
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopTimers();
    const beat = (): void => {
      this.socket?.send(JSON.stringify({ op: OP.HEARTBEAT, d: this.lastSeq ?? null }));
      // 一个心跳周期内没收到 op11 就判定连接僵死，主动断开触发重连。
      this.ackDeadline = setTimeout(() => {
        this.log('heartbeat ack timeout — reconnecting');
        this.socket?.close();
      }, intervalMs);
      this.heartbeatTimer = setTimeout(beat, intervalMs);
    };
    this.heartbeatTimer = setTimeout(beat, intervalMs);
  }

  private stopTimers(): void {
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer);
    if (this.ackDeadline !== undefined) clearTimeout(this.ackDeadline);
    this.heartbeatTimer = undefined;
    this.ackDeadline = undefined;
  }

  private async scheduleReconnect(reason: string): Promise<void> {
    if (this.disposed) return;
    this.log(`reconnecting in ${this.backoffMs}ms (${reason})`);
    await new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(resolve, this.backoffMs);
    });
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs ?? 30_000);
    await this.connect().catch((err: unknown) => {
      this.log(`reconnect failed: ${errMessage(err)}`);
      void this.scheduleReconnect('reconnect attempt failed');
    });
  }
}

// ---------------------------------------------------------------------- api

/** 超长文本分片（官方 textChunkLimit 语义：单条上限，超出切片发送）。 */
export function chunkText(text: string, limit = 4500): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit));
  return chunks;
}

export interface SentMessage {
  id: string;
  seq: number;
}

export interface SendOptions {
  content: string;
  /** 被动回复：入站事件的 msg_id（外层事件体的 d.id）。 */
  msgId?: string;
  baseUrl?: string;
}

/** BOT 身份读取的墙钟上限：一次**显示用**的读取，绝不能把设置页挂在「正在读取」上。 */
const IDENTITY_TIMEOUT_MS = 3_000;

/**
 * REST 发消息客户端：群聊 `POST /v2/groups/{group_openid}/messages`、
 * 单聊 `POST /v2/users/{user_openid}/messages`。msg_seq 按 msg_id 自增
 * （同 msg_id 多次回复去重需要递增 seq）；鉴权头 `Authorization: QQBot x`，
 * 401 时失效 token 让下次请求重取。
 */
export class QqApi {
  private readonly seqByMsgId = new Map<string, number>();

  constructor(
    private readonly token: AccessTokenManager,
    private readonly fetchFn: FetchLike,
    private readonly baseUrl = 'https://api.sgroup.qq.com',
  ) {}

  async sendGroupMessage(groupOpenid: string, opts: SendOptions): Promise<SentMessage[]> {
    return this.send(`/v2/groups/${groupOpenid}/messages`, opts);
  }

  async sendC2CMessage(userOpenid: string, opts: SendOptions): Promise<SentMessage[]> {
    return this.send(`/v2/users/${userOpenid}/messages`, opts);
  }

  /** BOT 名称缓存：键是换来 token 的那对凭据的 appId（凭据换了自然重取）。 */
  private identity: { appId: string; name: string | null } | undefined;

  /**
   * 机器人自己在 QQ 网关里的用户名（`GET /users/@me`）：取不到就给 null，调用方如实显示
   * 「取不到」，绝不编名字。按 appId 缓存（一次运行最多问一次），并带墙钟上限——显示用的
   * 读取不能把设置页挂住，而超时、网络失败、端点未开放都只是 null。
   */
  async botName(): Promise<string | null> {
    const appId = this.token.currentAppId();
    if (appId.length === 0) return null;
    if (this.identity?.appId === appId) return this.identity.name;
    const read = async (): Promise<string | null> => {
      const token = await this.token.get();
      const res = await this.fetchFn(`${this.baseUrl}/users/@me`, { headers: { Authorization: `QQBot ${token}` } });
      if (res.status === 401) this.token.invalidate();
      const body = (await res.json().catch(() => undefined)) as { username?: unknown } | undefined;
      return res.ok && typeof body?.username === 'string' && body.username.length > 0 ? body.username : null;
    };
    const name = await Promise.race([
      read().catch(() => null),
      new Promise<null>((resolve) => { setTimeout(() => { resolve(null); }, IDENTITY_TIMEOUT_MS); }),
    ]);
    this.identity = { appId, name };
    return name;
  }

  private nextSeq(msgId: string): number {
    const next = (this.seqByMsgId.get(msgId) ?? 0) + 1;
    this.seqByMsgId.set(msgId, next);
    return next;
  }

  private async send(path: string, opts: SendOptions): Promise<SentMessage[]> {
    const chunks = chunkText(opts.content);
    const sent: SentMessage[] = [];
    for (const chunk of chunks) {
      const body: Record<string, unknown> = { msg_type: 0, content: chunk };
      if (opts.msgId !== undefined) {
        body['msg_id'] = opts.msgId;
        body['msg_seq'] = this.nextSeq(opts.msgId);
      }
      const res = await this.request(path, body);
      const parsed = res as { id?: unknown };
      sent.push({ id: typeof parsed.id === 'string' ? parsed.id : '', seq: typeof body['msg_seq'] === 'number' ? body['msg_seq'] : 0 });
    }
    return sent;
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const token = await this.token.get();
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${token}` },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as unknown;
    if (!res.ok) {
      // 鉴权过期：作废 token，下次重取；错误仍如实上抛。
      if (res.status === 401) this.token.invalidate();
      const detail = typeof payload === 'object' && payload !== null ? JSON.stringify(payload) : String(payload);
      throw new Error(`qqbot: send failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    return payload;
  }
}
