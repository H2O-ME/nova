/**
 * 跑一次提示词，收敛到「这一轮结束」，返回要发回去的文本。
 *
 * 从对端编排（`peers.ts`）拆出，因为它是另一个问题：那边讲**谁跑哪一轮**（对端 →
 * 会话的编排：懒建、复用、激活、遥控旁路），这里讲**一轮内部怎么收尾**（订阅哪些事件、
 * 回复取哪条、失败怎么抛）。前者是路由，后者是单轮的执行语义。
 */
import type { AgentSession, KernelEvent } from '@nova-agent/core';
import type { Peer } from './types.js';
import type { PendingAsks } from './ask-forward.js';

/**
 * What a turn reports WHILE it runs.
 *
 * Separate from the return value because the two answer different questions: the
 * return value is what the caller must deliver, this is what the peer should be
 * told in the meantime. A long run that says nothing is indistinguishable from a
 * hung one, and the person holding a phone has no other way to tell.
 *
 * Every method must be cheap and must not throw — it runs inside the run's event
 * loop, and a chat that cannot be reached must not fail the work it describes.
 */
export interface TurnObserver {
  /** The turn was accepted and is starting. */
  accepted(): void;
  /** A tool call began. The name is the useful unit: it says what is happening. */
  tool(name: string): void;
}

/** What one turn produced. */
export interface TurnResult {
  /**
   * The LAST non-empty assistant message.
   *
   * The kernel logs every assistant message either way ("model-visible means
   * logged"), so this only fetches it for the wire, never for bookkeeping.
   */
  reply: string;
}

/**
 * Run one prompt on a peer's session, converging on "this turn is over".
 *
 * An approval raised mid-turn is forwarded to QQ (via `approvals`) rather
 * than auto-denied: the peer is right there in the chat window, they can
 * answer. `promptOnce` owns NOTHING else — the subscription is per turn and
 * released at idle, so no listener outlives its round.
 * @param agent - this peer's session.
 * @param asks - the pending-ask ledger (its fallback settles each on timeout).
 * @param text - the inbound prompt.
 * @param peer - who asked.
 * @param observer - progress reporting for the duration of this turn, if any.
 * @returns the reply the caller must deliver.
 */
export async function promptOnce(
  agent: AgentSession,
  asks: PendingAsks,
  text: string,
  peer: Peer,
  observer?: TurnObserver,
): Promise<TurnResult> {
  let reply = '';
  let failure: string | undefined;
  const finished = new Promise<void>((resolve) => {
    const unsubscribe = agent.subscribe((event: KernelEvent) => {
      if (event.type === 'message' && event.message.role === 'assistant' && event.message.content.trim().length > 0) {
        reply = event.message.content.trim();
      } else if (event.type === 'tool_call_start') {
        // Reported so the phone hears what is happening, not just that something is.
        try {
          observer?.tool(event.call.name);
        } catch {
          // Progress reporting is never allowed to break the run it describes.
        }
      } else if (event.type === 'run_failed') {
        failure = event.message;
      } else if (event.type === 'approval_request') {
        asks.forwardApproval(agent, peer, event.request);
      } else if (event.type === 'approval_resolved') {
        asks.settled(event.id);
      } else if (event.type === 'question_request') {
        // A question parks the run exactly like an approval does, so it must reach
        // the peer the same way — and be settled by `/answer`, which `inbound`'s
        // bypass delivers without waiting behind this very run.
        asks.forwardQuestion(agent, peer, event.request);
      } else if (event.type === 'question_resolved') {
        asks.settled(event.id);
      }
      if (event.type === 'phase' && event.phase === 'idle') {
        unsubscribe();
        resolve();
      }
    });
  });
  try {
    observer?.accepted();
  } catch {
    // Same rule as `tool`: narration never breaks the work.
  }
  await agent.prompt(text);
  await finished;
  if (failure !== undefined) throw new Error(failure);
  return { reply };
}

