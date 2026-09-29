/**
 * 被动窗口里的回复发送：一种答复，两种入口。
 *
 * 从 `inbound.ts` 拆出，因为它是另一个问题：那边讲**收到一条消息之后走哪条路**
 * （去重、记账、旁路还是排队），这里讲**答复发出去那一下**（按对端种类选落点、
 * 空答复不发、失败记一行）。前者是路由，后者是发送原语。
 */
import { errMessage } from '@nova-agent/core';
import type { Peer } from './types.js';
import type { ReplySink } from './inbound.js';

/**
 * Send one reply through the passive window, picking the sink by peer kind.
 *
 * Empty answers are dropped silently: an empty reply is not a failed reply,
 * it is nothing to say, and the gateway would reject it anyway.
 * @param reply - the two sinks, injected by the channel.
 * @param log - where a failure line goes.
 * @param peer - who to answer.
 * @param answer - the text.
 * @param msgId - the inbound message being answered.
 * @param tag - the log prefix naming the path (`remote` vs the queue).
 * @returns whether a reply actually went out (false: nothing to say, or the send failed).
 */
export async function sendReply(
  reply: ReplySink,
  log: (line: string) => void,
  peer: Peer,
  answer: string,
  msgId: string,
  tag: string,
): Promise<boolean> {
  if (answer.trim().length === 0) return false;
  try {
    const n = peer.kind === 'group'
      ? await reply.group(peer.openid, answer, msgId)
      : await reply.c2c(peer.openid, answer, msgId);
    log(`${tag} ${peer.peerId}: ${n} message(s)`);
    return true;
  } catch (err) {
    log(`${tag} failed for ${peer.peerId}: ${errMessage(err)}`);
    return false;
  }
}
