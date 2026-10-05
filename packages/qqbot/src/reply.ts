/**
 * The reply a chat receives, and the one place its outcome is reported.
 *
 * The WINDOW rule and the per-message allowance belong to the outbox
 * (`outbox.ts`), which every outbound path shares — so what remains here is the
 * part that is genuinely this file's job: an empty answer is not a failed answer,
 * and a failure is a line in the log plus an honest `false` to the caller's
 * counter.
 */
import type { Peer } from './types.js';

/** The outbound seam the inbound handler speaks; the outbox implements it. */
export interface ReplySink {
  /** Send one reply to a chat; the outbox resolves the passive window and budget. */
  reply(peerId: string, content: string): Promise<{ ok: boolean; reason?: string }>;
}

/**
 * Send one reply through the shared outbox.
 *
 * Empty answers are dropped silently: an empty reply is not a failed reply, it is
 * nothing to say, and the gateway would reject it anyway.
 * @param reply - the outbound seam, injected by the channel.
 * @param log - where a failure line goes.
 * @param peer - who to answer.
 * @param answer - the text.
 * @param tag - the log prefix naming the path (`remote` vs the queue).
 * @returns whether a reply actually went out (false: nothing to say, or refused).
 */
export async function sendReply(
  reply: ReplySink,
  log: (line: string) => void,
  peer: Peer,
  answer: string,
  tag: string,
): Promise<boolean> {
  if (answer.trim().length === 0) return false;
  const result = await reply.reply(peer.peerId, answer);
  if (result.ok) {
    log(`${tag} ${peer.peerId}: sent`);
    return true;
  }
  log(`${tag} not sent for ${peer.peerId}: ${result.reason ?? 'the outbox refused without a reason'}`);
  return false;
}
