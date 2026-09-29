/**
 * 通道的运行时接线：取值函数指向的可变凭据持有者 + 审批问题的即时推送。
 *
 * 从 `qqbot-bridge.ts` 拆出，因为它是另一个问题：桥那边讲**通道装不装得起来、跑没
 * 跑起来**（插件、启动入口、重读凭据），这里讲**装配时的两条边怎么连**：
 *
 *  - **凭据持有者**：通道对象必须稳定（已在 roster 候选清单里），而凭据是运行中改写
 *    的文件内容，所以通道拿到取值函数，`start()` 先重读再写进这里；
 *  - **审批推送**：runner 要在轮还没结束时先推一行出去（审批问题），而只有通道能发，
 *    所以 runner 先对一个迟绑定的通知器构造，通道后连上去。
 */
import type { Peer, QqBotChannel } from '@nova-agent/qqbot';
import { PeerTurns, type PeerNotifier, type QqBotKernelPort } from './qqbot-peer.js';

/** 装配结果：跑轮子的 + 通道建好后要连回去的那个引用。 */
export interface TurnWiring {
  turns: PeerTurns;
  /** 通道建好后调用它，把「审批问题即时推送」这条边连上。 */
  attachChannel: (channel: QqBotChannel) => void;
  /** 供 `createQqBotChannel` 的 brain：一条入站消息 → 这个对端的回复。 */
  brain: (text: string, peer: Peer) => Promise<string>;
}

/**
 * Assemble the turn runner against a late-bound channel reference.
 * @param kernel - the assembled kernel, resolved lazily.
 * @returns the runner, the attach step, and the brain callback.
 */
export function wireTurns(kernel: () => QqBotKernelPort | undefined): TurnWiring {
  // Two edges point at each other: the runner needs a way to push a line mid-turn
  // (an approval question, which only the channel can send), and the channel needs
  // the runner as its brain. One of them must be late, so the runner is built
  // FIRST against a late-bound notifier and the channel is wired second.
  let channel: QqBotChannel | undefined;
  const notify: PeerNotifier = (peer, text) => {
    // An approval question must go out NOW, not when the turn ends: the very
    // message it waits for is the one this turn is holding.
    const sending = channel;
    if (sending === undefined) return;
    if (sending.lastMsgIdOf(peer.peerId) === undefined) return;
    void sending.send(peer.peerId, text).catch(() => undefined);
  };
  const turns = new PeerTurns(kernel, notify);
  return {
    turns,
    attachChannel: (built) => {
      channel = built;
    },
    brain: (text, peer) => turns.run(text, peer),
  };
}

/** 取值函数指向的可变凭据持有者（见模块头）。 */
export interface LiveCredentials {
  appId: string;
  clientSecret: string;
}

/** An empty holder: safe to hand to the channel before any file exists. */
export function emptyCredentials(): LiveCredentials {
  return { appId: '', clientSecret: '' };
}
