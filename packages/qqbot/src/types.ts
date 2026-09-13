/** 入站事件负载（官方 autogen 事件页；字段按官方示例）。 */

export interface QqAuthor {
  id?: string;
  /** 群聊场景成员 openid。 */
  member_openid?: string;
  /** 单聊场景用户 openid。 */
  user_openid?: string;
  member_role?: string;
  username?: string;
}

export interface QqMessagePayload {
  /** 消息 id：被动回复的 msg_id（外层事件的 d.id）。 */
  id: string;
  author: QqAuthor;
  content: string;
  group_openid?: string;
  timestamp?: string;
}

export type PeerKind = 'group' | 'c2c';

export interface Peer {
  kind: PeerKind;
  openid: string;
  /** `group:<openid>` / `c2c:<openid>`（工具与日志统一使用）。 */
  peerId: string;
}

/** 从 dispatch 事件解析对端；非消息事件返回 undefined。 */
export function parseInbound(t: string, d: unknown): { peer: Peer; message: QqMessagePayload } | undefined {
  if (t !== 'GROUP_AT_MESSAGE_CREATE' && t !== 'C2C_MESSAGE_CREATE') return undefined;
  const msg = d as QqMessagePayload | undefined;
  if (msg === undefined || typeof msg.content !== 'string' || typeof msg.id !== 'string') return undefined;
  if (t === 'GROUP_AT_MESSAGE_CREATE') {
    if (typeof msg.group_openid !== 'string' || msg.group_openid.length === 0) return undefined;
    return { peer: { kind: 'group', openid: msg.group_openid, peerId: `group:${msg.group_openid}` }, message: msg };
  }
  const user = typeof msg.author?.user_openid === 'string' ? msg.author.user_openid : '';
  if (user.length === 0) return undefined;
  return { peer: { kind: 'c2c', openid: user, peerId: `c2c:${user}` }, message: msg };
}
