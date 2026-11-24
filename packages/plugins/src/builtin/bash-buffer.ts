import { StringDecoder } from 'node:string_decoder';

/**
 * Byte-budgeted stream capture keeping BOTH ends of the output, mirroring the
 * core's tool-result contract (`HEAD_TAIL_RATIO` in core/agent.ts): the head
 * 60% gives the summary, a ring-buffered tail 40% keeps the most recent
 * output — which is where test failures and stack traces live. The old
 * head-only capture silently threw away exactly the part that matters.
 * `dropped` counts the middle bytes that fit neither segment, so callers can
 * report them instead of pretending the output was intact.
 */
export class BudgetedBuffer {
  private head: Buffer[] = [];
  private tail: Buffer[] = [];
  private headBytes = 0;
  private tailBytes = 0;
  private droppedBytes_ = 0;
  private readonly headBudget: number;
  private readonly tailBudget: number;
  /**
   * Carries an incomplete trailing UTF-8 sequence across drains: jobs reads
   * split output at arbitrary read boundaries, and without decoder state a
   * multi-byte char (CJK, emoji) spanning two reads would surface as two
   * replacement glyphs instead of one char on the second read.
   */
  private readonly decoder = new StringDecoder('utf8');

  constructor(maxBytes: number) {
    this.headBudget = Math.floor(maxBytes * 0.6);
    this.tailBudget = maxBytes - this.headBudget;
  }

  get dropped(): number {
    return this.droppedBytes_;
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    let remaining = chunk;
    if (this.headBytes < this.headBudget) {
      const take = remaining.subarray(0, this.headBudget - this.headBytes);
      this.headBytes += take.length;
      this.head.push(take);
      if (take.length >= remaining.length) return;
      remaining = remaining.subarray(take.length);
    }
    // Ring-buffer the tail: evict the oldest tail bytes until the new chunk
    // fits (an eviction IS a middle byte: the head is full, the tail front
    // is no longer "most recent").
    while (remaining.length > this.tailBudget - this.tailBytes && this.tail.length > 0) {
      const front = this.tail.shift()!;
      this.tailBytes -= front.length;
      this.droppedBytes_ += front.length;
    }
    const space = this.tailBudget - this.tailBytes;
    if (remaining.length > space) {
      // A single chunk larger than the whole tail budget (a big pipe burst):
      // keep the chunk's END — the newest bytes are the ones that matter.
      const keep = Math.min(remaining.length, space);
      const start = remaining.length - keep;
      this.tail.push(remaining.subarray(start));
      this.tailBytes += keep;
      this.droppedBytes_ += remaining.length - keep;
    } else {
      this.tail.push(remaining);
      this.tailBytes += remaining.length;
    }
  }

  concat(): string {
    return Buffer.concat([...this.head, ...this.tail]).toString('utf8');
  }

  /**
   * Return the accumulated output AND drain it: subsequent reads see only new
   * output (the `jobs` tool contract — action=output reads since last read).
   * Decoded through the held StringDecoder state; an eviction seam (genuinely
   * dropped middle bytes) can still show a replacement glyph — those bytes no
   * longer exist.
   */
  drain(): { text: string; dropped: number } {
    const text = this.decoder.write(Buffer.concat([...this.head, ...this.tail]));
    const dropped = this.droppedBytes_;
    this.head = [];
    this.tail = [];
    this.headBytes = 0;
    this.tailBytes = 0;
    this.droppedBytes_ = 0;
    return { text, dropped };
  }
}
