/**
 * The frames that ANSWER a human ask: an approval verdict, a question answer, or
 * a dismissal of a whole question batch.
 *
 * Grouped because they share one contract and one failure mode. Each carries an id
 * the kernel minted and an answer the browser assembled, and each has TWO
 * validation gates behind it — the wire parser checked the answer's shape (core's
 * `parseAskResult` / `parseQuestionAnswer`) and the broker checks it against the
 * ask that is actually outstanding. This module owns the second half's reply: a
 * broker that refuses settles nothing, so the client has to be told, or it would
 * sit on a card for a wait that is already gone.
 *
 * Kept out of `frame-router.ts` so that switch stays a dispatch table rather than
 * the place where three id-mismatch messages are spelled out.
 */
import type { AgentSession } from '@nova-agent/core';
import { serializeServerFrame as serialize, type ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/** The three answering frames, already validated by `parseClientFrame`. */
export type HumanAnswerFrame = Extract<
  ClientFrame,
  { type: 'resolve_approval' } | { type: 'resolve_question' } | { type: 'cancel_question' }
>;

/**
 * Relay one answer into the kernel and report a refusal to the sender.
 * @param client - the socket the answer arrived on (only IT is told).
 * @param agent - the live session handle.
 * @param frame - the parsed frame.
 */
export function handleHumanAnswer(
  client: WsConnection,
  agent: AgentSession,
  frame: HumanAnswerFrame,
): void {
  switch (frame.type) {
    case 'resolve_approval':
      // The frame already carries a parsed `AskResult` — `client-frame.ts` runs
      // core's `parseAskResult` on the wire — so nothing re-normalizes here.
      if (!agent.resolveApproval(frame.id, frame.answer)) {
        client.send(serialize({ type: 'error', message: `未知的审批编号：${frame.id}` }));
      }
      break;
    case 'resolve_question':
      // A refused answer leaves the wait OPEN rather than settling it, so the
      // user can correct the frame; saying why is the only way they would know.
      if (!agent.resolveQuestion(frame.id, frame.answer)) {
        client.send(serialize({ type: 'error', message: `无效的问题答复（id: ${frame.id}）` }));
      }
      break;
    case 'cancel_question':
      if (!agent.cancelQuestion(frame.id)) {
        client.send(serialize({ type: 'error', message: `未知的问题编号：${frame.id}` }));
      }
      break;
  }
}
