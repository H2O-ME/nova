/**
 * The QQ gateway/API public face: protocol vocabulary, the gateway state
 * machine and the REST client.
 *
 * Split because they answer different questions and grew apart: the gateway
 * (`gateway.ts`) owns a long-lived, reconnecting connection with its own
 * lifecycle, while this file owns stateless request/response traffic. Both are
 * re-exported from here so the package's public face is unchanged and every
 * existing importer keeps reading `protocol.js`.
 */
export * from './gateway.js';
// The token/fetch vocabulary is shared by the gateway and the REST client, and
// every existing importer reads it from here (`runtime.ts`, `probe.ts`, the
// protocol tests). Re-exported so the split above shrinks nothing.
export { AccessTokenManager, TOKEN_ENDPOINT, type CredentialSource, type FetchLike, type HttpClientResponse } from './token.js';
import { withDeadline } from './deadline.js';
import type { AccessTokenManager, FetchLike } from './token.js';

// ---------------------------------------------------------------------- api

/**
 * 超长文本分片（官方 textChunkLimit 语义：单条上限，超出切片发送）。
 *
 * The limit is validated rather than trusted: this is public API, and a zero or
 * negative limit made the loop below never advance (`i += 0`), spinning forever
 * on one string.
 * @param text - the text to split.
 * @param limit - max characters per chunk; must be a positive finite integer.
 * @returns the chunks, in order.
 */
export function chunkText(text: string, limit = 4500): string[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`qqbot: chunkText limit must be a positive integer (got ${String(limit)})`);
  }
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
      const accessToken = await this.token.get();
      // Bounded with the shared helper rather than a hand-rolled race: the old
      // `Promise.race` left its timer armed after a fast answer (one stray timer
      // per call) and never cancelled the request it had abandoned.
      return await withDeadline(async (signal) => {
        const res = await this.fetchFn(`${this.baseUrl}/users/@me`, {
          headers: { Authorization: `QQBot ${accessToken}` },
          signal,
        });
        if (res.status === 401) this.token.invalidate();
        const body = (await res.json().catch(() => undefined)) as { username?: unknown } | undefined;
        return res.ok && typeof body?.username === 'string' && body.username.length > 0 ? body.username : null;
      }, 'bot identity', IDENTITY_TIMEOUT_MS);
    };
    const name = await read().catch(() => null);
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
      const parsed = await this.request(path, body);
      // A 2xx whose body carries no message id is NOT a delivered message. It was
      // previously counted as one (`id: ''`), so a platform rejection that still
      // answered 200 inflated the channel's reply tally and told the model the
      // send had landed.
      const id = typeof parsed === 'object' && parsed !== null ? (parsed as { id?: unknown }).id : undefined;
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(`qqbot: send failed (${'ok'}): response carried no message id`);
      }
      sent.push({ id, seq: typeof body['msg_seq'] === 'number' ? body['msg_seq'] : 0 });
    }
    return sent;
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const token = await this.token.get();
    const [status, payload] = await withDeadline(async (signal) => {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${token}` },
        body: JSON.stringify(body),
        signal,
      });
      // Read the body INSIDE the deadline and WITHOUT assuming it is JSON: an
      // error page (HTML, an empty 204) used to make `res.json()` throw before the
      // status was ever examined — so a 401 whose body was not JSON never
      // invalidated the token, and every later send reused the dead credential.
      const parsed = await res.json().catch(() => undefined);
      return [res.status, parsed] as const;
    }, 'send message');
    if (status < 200 || status >= 300) {
      // 鉴权过期：作废 token，下次重取；错误仍如实上抛。
      if (status === 401) this.token.invalidate();
      const detail = typeof payload === 'object' && payload !== null ? JSON.stringify(payload) : String(payload);
      throw new Error(`qqbot: send failed (${status}): ${detail.slice(0, 300)}`);
    }
    return payload;
  }
}

