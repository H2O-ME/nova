/**
 * 跑一次提示词，收敛到「这一轮结束」，返回要发回去的文本。
 *
 * 从对端编排（`peers.ts`）拆出，因为它是另一个问题：那边讲**谁跑哪一轮**（对端 → 会话
 * 的编排：懒建、复用、激活、遥控旁路），这里讲**一轮内部怎么收尾**（订阅哪些事件、
 * 回复取哪条、失败怎么抛）。前者是路由，后者是单轮的执行语义。
 */
import type { AgentSession, KernelEvent } from '@nova-agent/core';
import type { Peer } from './types.js';
import type { ApprovalForwarder } from './approval.js';

/**
 * Run one prompt on a peer's session, converging on "this turn is over".
 *
 * The reply is the LAST non-empty assistant `message`. The kernel logs it
 * either way ("model-visible means logged"), so this only fetches it for the
 * wire, never for bookkeeping.
 *
 * An approval raised mid-turn is forwarded to QQ (via `approvals`) rather
 * than auto-denied: the peer is right there in the chat window, they can
 * answer. `promptOnce` owns NOTHING else — the subscription is per turn and
 * released at idle, so no listener outlives its round.
 * @param agent - this peer's session.
 * @param approvals - the ask forwarder (its fallback answers on timeout).
 * @param text - the inbound prompt.
 * @param peer - who asked.
 * @returns the reply text to send back.
 */
export async function promptOnce(
  agent: AgentSession,
  approvals: ApprovalForwarder,
  text: string,
  peer: Peer,
): Promise<string> {
  let reply = '';
  let failure: string | undefined;
  const finished = new Promise<void>((resolve) => {
    const unsubscribe = agent.subscribe((event: KernelEvent) => {
      if (event.type === 'message' && event.message.role === 'assistant' && event.message.content.trim().length > 0) {
        reply = event.message.content.trim();
      } else if (event.type === 'run_failed') {
        failure = event.message;
      } else if (event.type === 'approval_request') {
        approvals.forward(agent, peer, event.request);
      } else if (event.type === 'approval_resolved') {
        approvals.settled(event.id);
      }
      if (event.type === 'phase' && event.phase === 'idle') {
        unsubscribe();
        resolve();
      }
    });
  });
  await agent.prompt(text);
  await finished;
  if (failure !== undefined) throw new Error(failure);
  return reply;
}
