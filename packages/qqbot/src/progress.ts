/**
 * Real-time reporting of a running turn back to the chat.
 *
 * The point of driving a machine from a phone is that you find out what is
 * happening WITHOUT opening a laptop. A turn that reports only its final answer is
 * indistinguishable from one that hung, and a long agent run can spend minutes in
 * tools before it has anything to say.
 *
 * So progress is forwarded — but it is BUDGETED, because the platform is not a
 * stream:
 *
 *  - an outbound message here is a PASSIVE REPLY, tied to one inbound `msg_id` and
 *    answered with an incrementing `msg_seq`. The platform bounds how many replies
 *    one inbound message may draw, so a per-token stream would spend the whole
 *    allowance in the first second and then fail — losing exactly the final answer
 *    the operator was waiting for.
 *  - therefore: one receipt, a bounded number of COALESCED updates, and a
 *    guarantee that the last one is always the answer.
 *
 * Tool names are the useful unit of progress (they say what the agent is doing),
 * and they are cheap to coalesce: several tools starting inside one interval become
 * one line rather than several messages.
 */

/** Minimum gap between two progress messages. */
export const PROGRESS_MIN_INTERVAL_MS = 4_000;
/** Hard cap on progress messages per turn, the final answer excluded. */
export const PROGRESS_MAX_UPDATES = 3;
/** How many tool names one coalesced line may list before it abbreviates. */
const TOOLS_PER_LINE = 6;

export interface ProgressRelayOptions {
  /** Where one line goes (the passive-window sender). Absent = nothing is sent. */
  send: (text: string) => void;
  minIntervalMs?: number;
  maxUpdates?: number;
  /** Injected clock, so the throttle is testable without waiting. */
  now?: () => number;
}

/**
 * One turn's outward narration.
 *
 * Every method is fire-and-forget: a chat that cannot be reached must never fail
 * the turn it is describing. Nothing here awaits, and nothing throws.
 */
export class ProgressRelay {
  private readonly send: (text: string) => void;
  private readonly minIntervalMs: number;
  private readonly maxUpdates: number;
  private readonly now: () => number;
  private updatesSent = 0;
  private lastSentAt = 0;
  /** Tool names seen since the last flush. */
  private pendingTools: string[] = [];
  /** Whether anything worth saying is buffered. */
  private dirty = false;
  private acceptedSent = false;

  constructor(options: ProgressRelayOptions) {
    this.send = options.send;
    this.minIntervalMs = options.minIntervalMs ?? PROGRESS_MIN_INTERVAL_MS;
    this.maxUpdates = options.maxUpdates ?? PROGRESS_MAX_UPDATES;
    this.now = options.now ?? Date.now;
  }

  /**
   * The receipt: sent once, immediately, and it does NOT count against the
   * progress budget. A peer who gets nothing for ten seconds cannot tell
   * "working" from "ignored", and this is the cheapest way to remove that doubt.
   */
  accepted(): void {
    if (this.acceptedSent) return;
    this.acceptedSent = true;
    this.emit('收到，开始处理。');
  }

  /** One tool call started; coalesced into the next flush. */
  tool(name: string): void {
    if (name.length === 0) return;
    this.pendingTools.push(name);
    this.dirty = true;
    this.flushIfDue();
  }

  /**
   * The turn is over. Always reported: the answer is what was asked for, so it is
   * never dropped for budget's sake — an update no longer fits, the answer still
   * goes, and what is dropped is the narration.
   */
  final(text: string): void {
    const body = text.trim();
    if (body.length === 0) {
      // Silence is a legitimate outcome (a turn that only ran tools). Say so
      // rather than leaving the receipt as the last word.
      if (this.acceptedSent) this.emit('（本轮没有要说的文本，工作已完成。）');
      return;
    }
    this.emit(body);
  }

  /** Flush buffered progress if the interval has passed and budget remains. */
  flushIfDue(): void {
    if (!this.dirty) return;
    if (this.updatesSent >= this.maxUpdates) return;
    const at = this.now();
    if (at - this.lastSentAt < this.minIntervalMs) return;
    const tools = this.pendingTools.splice(0, this.pendingTools.length);
    this.dirty = false;
    this.updatesSent += 1;
    this.lastSentAt = at;
    this.emit(tools.length === 0 ? '继续处理中…' : describeTools(tools));
  }

  /** One line out, with any transport failure absorbed (see the class comment). */
  private emit(text: string): void {
    try {
      this.send(text);
    } catch {
      // A chat that cannot be reached must never fail the turn it describes.
    }
  }
}

/** `正在：a、b、c（还有 2 个）` — one line, never a wall of names. */
function describeTools(tools: string[]): string {
  const shown = tools.slice(0, TOOLS_PER_LINE);
  const rest = tools.length - shown.length;
  return `正在：${shown.join('、')}${rest > 0 ? `（还有 ${rest} 个）` : ''}`;
}
