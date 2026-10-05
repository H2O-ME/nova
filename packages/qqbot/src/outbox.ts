/**
 * The one way anything goes OUT to QQ.
 *
 * Every outbound message in this package used to pick its own path — the inbound
 * reply, the approval notice, the progress relay, the model's `qqbot_send` tool —
 * and each independently asked for the passive window and sent. That is three
 * copies of the same three rules, and the rules are exactly the ones that bite:
 *
 *  - **which `msg_id`** the send belongs to. The platform only allows replying to
 *    the most recent inbound message, so a send without a live window must fail
 *    rather than become an unauthorized proactive message that the platform
 *    throttles or rejects.
 *  - **how many times** one inbound message may be answered. This is the scarce
 *    resource: the platform bounds replies per `msg_id`, and a per-token stream
 *    would spend the whole allowance before the agent had anything to say.
 *  - **who wins** when the allowance runs out. The conclusion is what was asked
 *    for; narration is what may be dropped — so narration is capped BELOW the
 *    allowance, keeping a reply's worth in reserve.
 *
 * The ledger is therefore keyed by `msg_id` and shared by every caller, which is
 * the only way those three answers can be consistent with each other.
 *
 * The per-window allowance is a deliberate guess: the platform documents a limit
 * but the exact number is not verifiable from here (no credentials, no live
 * account). It is therefore a named constant, comfortably conservative, and the
 * failure mode when it is wrong is a dropped narration line rather than a lost
 * answer.
 */
import type { Peer } from './types.js';

/** How many messages one inbound `msg_id` may draw in total. */
export const WINDOW_ALLOWANCE = 5;
/**
 * How many of those narration may spend. The rest is RESERVED for the reply:
 * `WINDOW_ALLOWANCE - NARRATION_ALLOWANCE` is the reply's guarantee, and it is
 * why the split exists rather than one shared counter.
 */
export const NARRATION_ALLOWANCE = 3;

/** What one send attempt ended as. */
export interface OutboxResult {
  ok: boolean;
  /** Why it did not go, in terms an operator can act on. */
  reason?: string;
}

export interface QqOutboxOptions {
  /** The transport: `msgId` absent means a proactive send with no window. */
  send: (peerId: string, content: string, msgId?: string) => Promise<string>;
  /** The live passive window for one peer, if any. */
  lastMsgIdOf: (peerId: string) => string | undefined;
  log?: (line: string) => void;
  windowAllowance?: number;
  narrationAllowance?: number;
}

/** One inbound message's spending so far. */
interface WindowLedger {
  used: number;
  /** The peer this window belongs to, so a mismatch is caught rather than sent. */
  peerId: string;
}

export class QqOutbox {
  private readonly send: QqOutboxOptions['send'];
  private readonly lastMsgIdOf: QqOutboxOptions['lastMsgIdOf'];
  private readonly log: (line: string) => void;
  private readonly windowAllowance: number;
  private readonly narrationAllowance: number;
  private readonly ledgers = new Map<string, WindowLedger>();

  constructor(options: QqOutboxOptions) {
    this.send = options.send;
    this.lastMsgIdOf = options.lastMsgIdOf;
    this.log = options.log ?? (() => undefined);
    this.windowAllowance = options.windowAllowance ?? WINDOW_ALLOWANCE;
    this.narrationAllowance = options.narrationAllowance ?? NARRATION_ALLOWANCE;
  }

  /**
   * Narration: a receipt, a progress line, an approval notice.
   *
   * Refused (and logged) once the narration allowance is spent, so the reply's
   * reserve survives. Never throws, never awaits: this runs inside a turn's event
   * loop, and a chat that cannot be reached must not fail the work it describes.
   * @param peerId - `group:<id>` / `c2c:<id>`.
   * @param content - the text.
   * @returns whether it went out.
   */
  narrate(peerId: string, content: string): OutboxResult {
    const window = this.lastMsgIdOf(peerId);
    if (window === undefined) return { ok: false, reason: 'no live passive-reply window for this peer' };
    const ledger = this.ledgerFor(window, peerId);
    if (ledger.used >= this.narrationAllowance) {
      return { ok: false, reason: `narration allowance spent for this message (${this.narrationAllowance})` };
    }
    ledger.used += 1;
    void this.send(peerId, content, window).catch((err: unknown) => {
      this.log(`qqbot: narration send failed for ${peerId}: ${String(err)}`);
    });
    return { ok: true };
  }

  /**
   * The reply to an inbound message: it may spend the reserve narration left.
   *
   * Awaited by the caller because the inbound handler reports whether a reply
   * actually went out, and because the platform's answer is the only proof it did.
   * @param peerId - `group:<id>` / `c2c:<id>`.
   * @param content - the text.
   * @returns whether it went out, or why not.
   */
  async reply(peerId: string, content: string): Promise<OutboxResult> {
    if (content.trim().length === 0) return { ok: false, reason: 'nothing to say' };
    const window = this.lastMsgIdOf(peerId);
    if (window === undefined) return { ok: false, reason: 'no live passive-reply window for this peer' };
    const ledger = this.ledgerFor(window, peerId);
    if (ledger.used >= this.windowAllowance) {
      // The reserve is gone too: the platform's own bound is what is left, and
      // sending into it fails at the platform rather than here. Refusing is the
      // honest report; the text is already durable in the session log, so nothing
      // is lost that `/history` cannot reach.
      return { ok: false, reason: `reply allowance spent for this message (${this.windowAllowance})` };
    }
    ledger.used += 1;
    try {
      await this.send(peerId, content, window);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: `send failed: ${String(err)}` };
    }
  }

  /**
   * A proactive send to a named peer (the model's `qqbot_send` tool).
   *
   * Same window rule as everything else: without a live window there is nothing to
   * reply to, and the platform's proactive path is throttled. It draws on the
   * NARRATION budget, not the reply's reserve: the tool's output is not what the
   * peer asked for, so it must not be able to spend the answer's guarantee. (It
   * used to go through `reply`, which let a chatty turn spend the reserve on its
   * own messages and then drop the actual answer.)
   * @param peerId - `group:<id>` / `c2c:<id>`.
   * @param content - the text.
   * @returns whether it went out, or why not.
   */
  async proactive(peerId: string, content: string): Promise<OutboxResult> {
    if (content.trim().length === 0) return { ok: false, reason: 'nothing to say' };
    const window = this.lastMsgIdOf(peerId);
    if (window === undefined) {
      return { ok: false, reason: 'no live passive-reply window for this peer' };
    }
    const ledger = this.ledgerFor(window, peerId);
    if (ledger.used >= this.narrationAllowance) {
      return { ok: false, reason: `proactive allowance spent for this message (${this.narrationAllowance})` };
    }
    ledger.used += 1;
    try {
      await this.send(peerId, content, window);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: `send failed: ${String(err)}` };
    }
  }

  /** The window's ledger, created on first use and dropped when the window moves on. */
  private ledgerFor(window: string, peerId: string): WindowLedger {
    const existing = this.ledgers.get(window);
    if (existing !== undefined && existing.peerId === peerId) return existing;
    const created: WindowLedger = { used: 0, peerId };
    this.ledgers.set(window, created);
    // Bounded: a window only matters while it is the live one, and old keys are
    // unreachable. Pruning on insert keeps a long-running channel from growing one
    // entry per inbound message forever.
    if (this.ledgers.size > 512) {
      const oldest = this.ledgers.keys().next().value;
      if (oldest !== undefined) this.ledgers.delete(oldest);
    }
    return created;
  }
}

/** The `PeerNotifier` shape `PendingAsks`/`ProgressRelay` consume, over one outbox. */
export function outboxNotifier(outbox: QqOutbox): (peer: Peer, text: string) => void {
  return (peer, text) => {
    outbox.narrate(peer.peerId, text);
  };
}
